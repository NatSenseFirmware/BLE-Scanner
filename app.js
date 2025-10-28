'use strict';

let theDevice = null;
let theServer = null;
let characteristicMap = new Map();
let currentNotifyCharacteristic = null;
let currentNotifyHandler = null;

function isWebBluetoothEnabled() { 
    if (navigator.bluetooth) { 
        return true; 
    } else {
        return false; 
    }
}

function onConnected() {
    document.querySelector('#progressbar').classList.add('hidden');
    document.querySelector('.connect-button').removeAttribute("disabled");
    console.log("BLE connected");
    dialog.close();    
}

function onDisconnected() {
    console.log("BLE disconnected");
    // document.querySelector('.connect-button').classList.remove('hidden');
    // document.querySelector('form').classList.remove('hidden');
}

// Ensure an active GATT connection before operations
function ensureConnected(waitMs = 500) {
    if (theDevice && theDevice.gatt) {
        if (!theDevice.gatt.connected) {
            return theDevice.gatt.connect()
                .then(server => {
                    theServer = server;
                    return new Promise(resolve => setTimeout(resolve, waitMs));
                });
        }
    }
    return Promise.resolve();
}

function connect() {
    let optionalServices = document.querySelector('#optionalServices').value.split(/, ?/g).filter(s => s.length > 0);
    if (optionalServices.length === 0) {
        return; // No services specified
    }

    const services = optionalServices.map(s => {
        if (s.startsWith('0x')) {
            return parseInt(s);
        }
        return s;
    });

    console.log('Requesting Bluetooth Device...');
    navigator.bluetooth.requestDevice({
        // Use a broader scan like LightBlue; permission will still include the service
        acceptAllDevices: true,
        optionalServices: services
    })
    .then(device => {
        theDevice = device;
        console.log('> Found ' + (device.name || 'Unknown'));
        console.log('Connecting to GATT Server...');
        device.addEventListener('gattserverdisconnected', onDisconnected);
        return device.gatt.connect();
    })
    .then(server => {
        theServer = server;
        console.log('Gatt connected');
        onConnected();

        return new Promise(resolve => setTimeout(resolve, 500));
    })
    .then(() => getServicesWithRetry(3, 800))
    .then(services => {
        console.log('Getting Characteristics...');
        let queue = Promise.resolve();
        characteristicMap.clear();
        services.forEach(service => {
            queue = queue.then(() => service.getCharacteristics().then(characteristics => {
                characteristicMap.set(service.uuid, characteristics);
                console.log('> Service: ' + service.uuid);
                characteristics.forEach(characteristic => {
                    console.log('>> Characteristic: ' + characteristic.uuid + ' ' +
                        getSupportedProperties(characteristic));
                });
            }));
        });
        return queue.then(() => services);
    })
    .then(services => {
        // Populate dropdowns
        populateServiceDropdown(services);
        // Enable buttons (MDL anchors may have is-disabled class)
        const readBtn = document.querySelector('#read');
        const writeBtn = document.querySelector('#write');
        readBtn.removeAttribute('disabled');
        writeBtn.removeAttribute('disabled');
        readBtn.classList.remove('is-disabled');
        writeBtn.classList.remove('is-disabled');
        const subBtn = document.querySelector('#subscribe');
        const unsubBtn = document.querySelector('#unsubscribe');
        if (subBtn && unsubBtn) {
            subBtn.removeAttribute('disabled');
            unsubBtn.removeAttribute('disabled');
            subBtn.classList.remove('is-disabled');
            unsubBtn.classList.remove('is-disabled');
        }
    })
    .catch(error => {
        console.log('Argh! ' + error);
        document.querySelector('#progressbar').classList.add('hidden');
        document.querySelector('.connect-button').removeAttribute("disabled");
        var notification = document.querySelector('.mdl-js-snackbar');
        notification.MaterialSnackbar.showSnackbar(
            {
                message: 'Error while connecting to BLE, please try again.'
            }
        );
    });
}

function getSupportedProperties(characteristic) {
    let supportedProperties = [];
    for (const p in characteristic.properties) {
      if (characteristic.properties[p] === true) {
        supportedProperties.push(p.toUpperCase());
      }
    }
    return '[' + supportedProperties.join(', ') + ']';
}

// Convert DataView to space-separated hex string
function dataViewToHex(dataView) {
    const bytes = new Uint8Array(dataView.buffer);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
function dataViewToBase64(dataView) {
    const bytes = new Uint8Array(dataView.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
function dataViewToBits(dataView) {
    const bytes = new Uint8Array(dataView.buffer);
    return Array.from(bytes).map(b => b.toString(2).padStart(8, '0')).join(' ');
}

// Parse a user-entered string into bytes (hex or text)
function parseInputToBytes(text) {
    const trimmed = text.trim();
    // Match sequences of hex bytes (e.g., "01 02", "0x01 0x02", "0102")
    const hexLike = /^(?:0x)?[0-9a-fA-F]{2}(?:\s*(?:0x)?[0-9a-fA-F]{2})*$/;
    if (hexLike.test(trimmed.replace(/,/g, ' '))) {
        const normalized = trimmed.replace(/0x/gi, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
        const parts = normalized.length ? normalized.split(' ') : [];
        const bytes = new Uint8Array(parts.map(h => parseInt(h, 16)));
        return bytes;
    }
    // Fallback to UTF-8 text
    return new TextEncoder('utf-8').encode(text);
}

function getValueFormat() {
    const sel = document.querySelector('#valueFormat');
    return sel ? sel.value : 'Hex';
}

function decodeByFormat(dataView, format) {
    try {
        switch (format) {
            case 'Hex':
                return dataViewToHex(dataView);
            case 'UTF8':
                return new TextDecoder('utf-8').decode(dataView);
            case 'Base64':
                return dataViewToBase64(dataView);
            case 'Bits':
                return dataViewToBits(dataView);
            case 'Uint8':
                return String(dataView.getUint8(0));
            case 'Int8':
                return String(dataView.getInt8(0));
            case 'Uint16LE':
                return String(dataView.getUint16(0, true));
            case 'Uint16BE':
                return String(dataView.getUint16(0, false));
            case 'Int16LE':
                return String(dataView.getInt16(0, true));
            case 'Int16BE':
                return String(dataView.getInt16(0, false));
            case 'Uint32LE':
                return String(dataView.getUint32(0, true));
            case 'Uint32BE':
                return String(dataView.getUint32(0, false));
            case 'Int32LE':
                return String(dataView.getInt32(0, true));
            case 'Int32BE':
                return String(dataView.getInt32(0, false));
            case 'Float32LE':
                return String(dataView.getFloat32(0, true));
            case 'Float32BE':
                return String(dataView.getFloat32(0, false));
            default:
                return dataViewToHex(dataView);
        }
    } catch (e) {
        console.log('Decode error for format', format, e);
        return dataViewToHex(dataView);
    }
}

function encodeByFormat(inputText, format) {
    if (format === 'Hex') {
        return parseInputToBytes(inputText);
    }
    if (format === 'UTF8') {
        return new TextEncoder('utf-8').encode(inputText);
    }
    if (format === 'Base64') {
        const normalized = inputText.trim();
        try {
            const bin = atob(normalized);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
        } catch (e) {
            throw new Error('Invalid Base64 input');
        }
    }
    if (format === 'Bits') {
        const groups = inputText.trim().split(/\s+/);
        const bytes = new Uint8Array(groups.map(g => {
            if (!/^([01]{8})$/.test(g)) throw new Error('Invalid bits group: ' + g);
            return parseInt(g, 2);
        }));
        return bytes;
    }
    let num = Number(inputText);
    if (!isFinite(num)) {
        throw new Error('Input is not a valid number for format ' + format);
    }
    let buf, dv;
    switch (format) {
        case 'Uint8':
            buf = new ArrayBuffer(1); dv = new DataView(buf); dv.setUint8(0, num); return new Uint8Array(buf);
        case 'Int8':
            buf = new ArrayBuffer(1); dv = new DataView(buf); dv.setInt8(0, num); return new Uint8Array(buf);
        case 'Uint16LE':
            buf = new ArrayBuffer(2); dv = new DataView(buf); dv.setUint16(0, num, true); return new Uint8Array(buf);
        case 'Uint16BE':
            buf = new ArrayBuffer(2); dv = new DataView(buf); dv.setUint16(0, num, false); return new Uint8Array(buf);
        case 'Int16LE':
            buf = new ArrayBuffer(2); dv = new DataView(buf); dv.setInt16(0, num, true); return new Uint8Array(buf);
        case 'Int16BE':
            buf = new ArrayBuffer(2); dv = new DataView(buf); dv.setInt16(0, num, false); return new Uint8Array(buf);
        case 'Uint32LE':
            buf = new ArrayBuffer(4); dv = new DataView(buf); dv.setUint32(0, num, true); return new Uint8Array(buf);
        case 'Uint32BE':
            buf = new ArrayBuffer(4); dv = new DataView(buf); dv.setUint32(0, num, false); return new Uint8Array(buf);
        case 'Int32LE':
            buf = new ArrayBuffer(4); dv = new DataView(buf); dv.setInt32(0, num, true); return new Uint8Array(buf);
        case 'Int32BE':
            buf = new ArrayBuffer(4); dv = new DataView(buf); dv.setInt32(0, num, false); return new Uint8Array(buf);
        case 'Float32LE':
            buf = new ArrayBuffer(4); dv = new DataView(buf); dv.setFloat32(0, num, true); return new Uint8Array(buf);
        case 'Float32BE':
            buf = new ArrayBuffer(4); dv = new DataView(buf); dv.setFloat32(0, num, false); return new Uint8Array(buf);
        default:
            return parseInputToBytes(inputText);
    }
}

// Populate service dropdown with discovered services
function populateServiceDropdown(services) {
    const serviceSelect = document.querySelector('#serviceSelect');
    if (!serviceSelect) return;
    serviceSelect.innerHTML = '';
    services.forEach(svc => {
        const opt = document.createElement('option');
        opt.value = svc.uuid;
        opt.textContent = svc.uuid;
        serviceSelect.appendChild(opt);
    });

    // Set text input to first discovered service for backward compatibility
    if (services.length > 0) {
        document.querySelector('#service').value = services[0].uuid;
        updateCharacteristicDropdown(services[0].uuid);
    }

    serviceSelect.onchange = (e) => {
        const selected = e.target.value;
        document.querySelector('#service').value = selected;
        updateCharacteristicDropdown(selected);
    };
}

// Populate characteristic dropdown based on selected service
function updateCharacteristicDropdown(serviceUuid) {
    const charSelect = document.querySelector('#characteristicSelect');
    if (!charSelect) return;
    charSelect.innerHTML = '';
    const chars = characteristicMap.get(serviceUuid) || [];
    chars.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.uuid;
        opt.textContent = ch.uuid + ' ' + getSupportedProperties(ch);
        charSelect.appendChild(opt);
    });

    if (chars.length > 0) {
        document.querySelector('#characteristic').value = chars[0].uuid;
    }

    charSelect.onchange = (e) => {
        document.querySelector('#characteristic').value = e.target.value;
    };
}

function read() {
    let serviceUuid = document.querySelector('#service').value;
    if (serviceUuid.startsWith('0x')) {
        serviceUuid = parseInt(serviceUuid);
    }

    let characteristicUuid = document.querySelector('#characteristic').value;
    if (characteristicUuid.startsWith('0x')) {
        characteristicUuid = parseInt(characteristicUuid);
    }

    console.log("serviceUuid", serviceUuid, "characteristicUuid", characteristicUuid);

    const format = getValueFormat();
    ensureConnected()
    .then(() => theServer.getPrimaryService(serviceUuid))
    .then(service => {
        return service.getCharacteristic(characteristicUuid);
    })
    .then(characteristic => {
        if (!characteristic.properties.read) {
            console.log('Characteristic does not support READ. If it supports NOTIFY, enable notifications on the device.');
        }
        return characteristic.readValue();
    })
    .then(value => {
        const hex = dataViewToHex(value);
        console.log('Received (hex): ' + hex);
        console.log('Received (raw bytes):', Array.from(new Uint8Array(value.buffer)));
        
        const decodedAll = decodeAllByFormat(value, format);
        console.log('Received (' + format + ' all): ' + decodedAll);
        
        // Also show individual decoded values for debugging
        if (format !== 'Auto') {
            const len = value.byteLength;
            for (let i = 0; i < len; i++) {
                try {
                    const byte = value.getUint8(i);
                    console.log(`Byte ${i}: ${byte} (0x${byte.toString(16).padStart(2, '0')})`);
                } catch (e) {
                    console.log(`Byte ${i}: Error reading - ${e.message}`);
                }
            }
        }
        
        document.querySelector('#value').value = decodedAll;
    })
    .catch(error => {
        console.log('Argh! ' + error);
    });
}

function write() {
    let serviceUuid = document.querySelector('#service').value;
    if (serviceUuid.startsWith('0x')) {
        serviceUuid = parseInt(serviceUuid);
    }

    let characteristicUuid = document.querySelector('#characteristic').value;
    if (characteristicUuid.startsWith('0x')) {
        characteristicUuid = parseInt(characteristicUuid);
    }

    const format = getValueFormat();
    const writeModeSel = document.querySelector('#writeMode');
    const writeMode = writeModeSel ? writeModeSel.value : 'Auto';
    const termSel = document.querySelector('#writeTerminator');
    const terminator = termSel ? termSel.value : 'None';
    const autoRead = !!(document.querySelector('#autoReadAfterWrite') && document.querySelector('#autoReadAfterWrite').checked);
    ensureConnected()
    .then(() => theServer.getPrimaryService(serviceUuid))
    .then(service => {
        return service.getCharacteristic(characteristicUuid);
    })
    .then(async characteristic => {
        const input = document.querySelector('#value').value;
        let bytes = encodeByFormat(input, format);

        // Apply terminator if requested
        if (terminator && terminator !== 'None') {
            let termBytes;
            switch (terminator) {
                case 'LF': termBytes = new Uint8Array([0x0A]); break;
                case 'CR': termBytes = new Uint8Array([0x0D]); break;
                case 'CRLF': termBytes = new Uint8Array([0x0D, 0x0A]); break;
                default: termBytes = new Uint8Array([]);
            }
            const merged = new Uint8Array(bytes.length + termBytes.length);
            merged.set(bytes, 0);
            merged.set(termBytes, bytes.length);
            bytes = merged;
        }

        // Decide write method
        const canWith = characteristic.properties.write && typeof characteristic.writeValueWithResponse === 'function';
        const canWithout = characteristic.properties.writeWithoutResponse && typeof characteristic.writeValueWithoutResponse === 'function';

        const logSent = () => {
            console.log('Sent:', dataViewToHex(new DataView(bytes.buffer)));
            appendToStream('Sent: ' + Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' '));
        };

        if (writeMode === 'WithResponse' && canWith) {
            await characteristic.writeValueWithResponse(bytes);
            logSent();
            return;
        }
        if (writeMode === 'WithoutResponse' && canWithout) {
            await characteristic.writeValueWithoutResponse(bytes);
            logSent();
            return;
        }
        if (writeMode === 'Generic' && typeof characteristic.writeValue === 'function') {
            await characteristic.writeValue(bytes);
            logSent();
            return;
        }
        // Auto selection
        if (canWith) {
            await characteristic.writeValueWithResponse(bytes);
            logSent();
        } else if (canWithout) {
            await characteristic.writeValueWithoutResponse(bytes);
            logSent();
        } else if (typeof characteristic.writeValue === 'function') {
            await characteristic.writeValue(bytes);
            logSent();
        } else {
            throw new Error('Characteristic does not support any write method');
        }
    })
    .then(_ => {
        console.log('Sent value successfully');
        if (autoRead) {
            try { read(); } catch (e) { console.log('Auto read failed:', e); }
        }
    })
    .catch(error => {
        console.log('Argh! ' + error);
        var notification = document.querySelector('.mdl-js-snackbar');
        if (notification && notification.MaterialSnackbar) {
            notification.MaterialSnackbar.showSnackbar({ message: 'Write error: ' + error });
        }
    });
}

function decodeAllByFormat(dataView, format) {
    try {
        const len = dataView.byteLength;
        
        // Auto-detect characteristic type based on UUID if format is Auto
        if (format === 'Auto') {
            const charUuid = document.querySelector('#characteristic')?.value || '';
            if (charUuid.toLowerCase().includes('ffe0')) {
                // FFE0: Boolean (0/1) - single byte boolean
                return len > 0 ? String(dataView.getUint8(0) > 0 ? 1 : 0) : '0';
            } else if (charUuid.toLowerCase().includes('ffe1')) {
                // FFE1: Numeric value - single byte number
                return len > 0 ? String(dataView.getUint8(0)) : '0';
            } else if (charUuid.toLowerCase().includes('ffe3')) {
                // FFE3: Binary pattern - show as hex
                return dataViewToHex(dataView);
            }
        }
        
        switch (format) {
            case 'Hex':
                return dataViewToHex(dataView);
            case 'UTF8':
                return new TextDecoder('utf-8').decode(dataView);
            case 'Base64':
                return dataViewToBase64(dataView);
            case 'Bits':
                return dataViewToBits(dataView);
            case 'Uint8': {
                const arr = [];
                for (let i = 0; i < len; i += 1) arr.push(dataView.getUint8(i));
                return arr.join(' ');
            }
            case 'Int8': {
                const arr = [];
                for (let i = 0; i < len; i += 1) arr.push(dataView.getInt8(i));
                return arr.join(' ');
            }
            case 'Uint16LE': {
                const arr = [];
                for (let i = 0; i + 1 < len; i += 2) arr.push(dataView.getUint16(i, true));
                return arr.join(' ');
            }
            case 'Uint16BE': {
                const arr = [];
                for (let i = 0; i + 1 < len; i += 2) arr.push(dataView.getUint16(i, false));
                return arr.join(' ');
            }
            case 'Int16LE': {
                const arr = [];
                for (let i = 0; i + 1 < len; i += 2) arr.push(dataView.getInt16(i, true));
                return arr.join(' ');
            }
            case 'Int16BE': {
                const arr = [];
                for (let i = 0; i + 1 < len; i += 2) arr.push(dataView.getInt16(i, false));
                return arr.join(' ');
            }
            case 'Uint32LE': {
                const arr = [];
                for (let i = 0; i + 3 < len; i += 4) arr.push(dataView.getUint32(i, true));
                return arr.join(' ');
            }
            case 'Uint32BE': {
                const arr = [];
                for (let i = 0; i + 3 < len; i += 4) arr.push(dataView.getUint32(i, false));
                return arr.join(' ');
            }
            case 'Int32LE': {
                const arr = [];
                for (let i = 0; i + 3 < len; i += 4) arr.push(dataView.getInt32(i, true));
                return arr.join(' ');
            }
            case 'Int32BE': {
                const arr = [];
                for (let i = 0; i + 3 < len; i += 4) arr.push(dataView.getInt32(i, false));
                return arr.join(' ');
            }
            case 'Float32LE': {
                const arr = [];
                for (let i = 0; i + 3 < len; i += 4) arr.push(dataView.getFloat32(i, true));
                return arr.join(' ');
            }
            case 'Float32BE': {
                const arr = [];
                for (let i = 0; i + 3 < len; i += 4) arr.push(dataView.getFloat32(i, false));
                return arr.join(' ');
            }
            default:
                return dataViewToHex(dataView);
        }
    } catch (e) {
        console.log('Decode-all error for format', format, e);
        return dataViewToHex(dataView);
    }
}

function appendToStream(text) {
    const ta = document.querySelector('#stream');
    if (!ta) return;
    const ts = new Date().toLocaleTimeString();
    ta.value += `[${ts}] ${text}\n`;
    ta.scrollTop = ta.scrollHeight;
}

function subscribe() {
    let serviceUuid = document.querySelector('#service').value;
    if (serviceUuid.startsWith('0x')) {
        serviceUuid = parseInt(serviceUuid);
    }

    let characteristicUuid = document.querySelector('#characteristic').value;
    if (characteristicUuid.startsWith('0x')) {
        characteristicUuid = parseInt(characteristicUuid);
    }

    const format = getValueFormat();
    ensureConnected()
    .then(() => theServer.getPrimaryService(serviceUuid))
    .then(service => service.getCharacteristic(characteristicUuid))
    .then(async characteristic => {
        if (!characteristic.properties.notify) {
            console.log('Characteristic does not support NOTIFY.');
            return;
        }
        const handler = (event) => {
            const dv = event.target.value;
            const hex = dataViewToHex(dv);
            console.log('Notify (hex): ' + hex);
            console.log('Notify (raw bytes):', Array.from(new Uint8Array(dv.buffer)));
            
            const decodedAll = decodeAllByFormat(dv, format);
            console.log('Notify (' + format + ' all): ' + decodedAll);
            
            // Also show individual decoded values for debugging
            if (format !== 'Auto') {
                const len = dv.byteLength;
                for (let i = 0; i < len; i++) {
                    try {
                        const byte = dv.getUint8(i);
                        console.log(`Notify Byte ${i}: ${byte} (0x${byte.toString(16).padStart(2, '0')})`);
                    } catch (e) {
                        console.log(`Notify Byte ${i}: Error reading - ${e.message}`);
                    }
                }
            }
            
            appendToStream(decodedAll);
        };
        characteristic.addEventListener('characteristicvaluechanged', handler);
        await characteristic.startNotifications();
        currentNotifyCharacteristic = characteristic;
        currentNotifyHandler = handler;
        console.log('Subscribed to notifications');
    })
    .catch(error => {
        console.log('Argh! ' + error);
    });
}

function unsubscribe() {
    if (!currentNotifyCharacteristic) return;
    currentNotifyCharacteristic.removeEventListener('characteristicvaluechanged', currentNotifyHandler);
    currentNotifyCharacteristic.stopNotifications()
    .then(() => {
        console.log('Unsubscribed from notifications');
        currentNotifyCharacteristic = null;
        currentNotifyHandler = null;
    })
    .catch(error => {
        console.log('Argh! ' + error);
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRequestedServiceUuids() {
    const input = document.querySelector('#optionalServices').value;
    return input.split(/, ?/g)
        .filter(s => s.length > 0)
        .map(s => s.startsWith('0x') ? parseInt(s) : s);
}

function getServicesWithRetry(maxAttempts = 3, delayMs = 800) {
    let attempt = 1;
    const doAttempt = () => {
        console.log(`Getting Services (attempt ${attempt}/${maxAttempts})...`);
        return ensureConnected(600)
            .then(() => {
                if (typeof theServer.getPrimaryServices === 'function') {
                    return theServer.getPrimaryServices();
                }
                const uuids = getRequestedServiceUuids();
                return Promise.all(uuids.map(u => theServer.getPrimaryService(u)));
            })
            .catch(async (err) => {
                console.log('Service list retrieval failed, checking connection...', err);
                if (theDevice && theDevice.gatt && !theDevice.gatt.connected) {
                    console.log('Reconnecting to GATT server...');
                    theServer = await theDevice.gatt.connect();
                }
                if (attempt < maxAttempts) {
                    attempt += 1;
                    await sleep(delayMs);
                    return doAttempt();
                }
                throw err;
            });
    };
    return doAttempt();
}