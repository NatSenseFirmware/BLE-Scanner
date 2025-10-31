'use strict';

let theDevice = null;
let theServer = null;
let characteristicMap = new Map();
let currentNotifyCharacteristic = null;
let currentNotifyHandler = null;

// Periodic reading and data collection variables
let periodicReadInterval = null;
let collectedData = [];
let dataChart = null;
let isPeriodicReading = false;
let schedulerCallCount = 0; // Counter for scheduler calls

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
        // Auto-select FFE3 and start collection if available
        try { autoSelectFFE3AndStart(); } catch (_) {}
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
        // Auto-start or restart when service changes
        autoStartPeriodicRead();
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
        // Auto-start with the first characteristic
        autoStartPeriodicRead();
    }

    charSelect.onchange = (e) => {
        document.querySelector('#characteristic').value = e.target.value;
        // Auto-start or restart when characteristic changes
        autoStartPeriodicRead();
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

// -------- Periodic Reading, Charting, and CSV Export --------

function setButtonEnabled(id, enabled) {
    // Support both current and legacy IDs to avoid null element issues
    const idAliases = {
        startPeriodic: ['startPeriodic', 'startPeriodicRead'],
        stopPeriodic: ['stopPeriodic', 'stopPeriodicRead'],
        read: ['read'],
        write: ['write'],
        subscribe: ['subscribe'],
        unsubscribe: ['unsubscribe'],
    };
    const targets = idAliases[id] || [id];
    targets.forEach(tid => {
        const el = document.getElementById(tid);
        if (!el) return;
        if (enabled) {
            el.removeAttribute('disabled');
            el.classList.remove('is-disabled');
        } else {
            el.setAttribute('disabled', '');
            el.classList.add('is-disabled');
        }
    });
}

function parseADCData(dataView, serviceUuid, characteristicUuid) {
    const s = serviceUuid ? String(serviceUuid).toLowerCase() : '';
    const c = characteristicUuid ? String(characteristicUuid).toLowerCase() : '';
    const isADC = s.includes('ffe3') || c.includes('ffe3');
    if (!isADC) return null;
    const bytes = new Uint8Array(dataView.buffer);
    if (bytes.length < 8) return null;
    const channels = [];
    for (let i = 0; i < 4; i++) {
        const offset = i * 2;
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        channels.push({
            channel: i + 1,
            rawValue: value,
            voltage: (value / 4095.0) * 3.3,
            percentage: (value / 4095.0) * 100,
        });
    }
    return channels;
}

function startPeriodicReading() {
    if (isPeriodicReading) {
        console.log('Periodic reading already running');
        return;
    }

    const intervalSelect = document.querySelector('#readInterval');
    const intervalMs = parseInt(intervalSelect && intervalSelect.value ? intervalSelect.value : '0', 10);
    if (!intervalMs || intervalMs < 1000) {
        console.error('Invalid interval selected');
        return;
    }

    // Guard: ensure service and characteristic fields exist
    const svcEl = document.querySelector('#service');
    const chEl = document.querySelector('#characteristic');
    if (!svcEl || !chEl) {
        console.error('Service/Characteristic inputs not found in DOM');
        return;
    }

    isPeriodicReading = true;
    setButtonEnabled('startPeriodic', false);
    setButtonEnabled('stopPeriodic', true);

    console.log('Starting periodic reading every', intervalMs, 'ms');
    console.log('Service:', svcEl.value, 'Characteristic:', chEl.value);
    
    // Reset scheduler counter when starting new periodic reading
    schedulerCallCount = 0;
    updateSchedulerCounter();
    
    performPeriodicRead();
    periodicReadInterval = setInterval(performPeriodicRead, intervalMs);
}

function stopPeriodicReading() {
    if (!isPeriodicReading) return;
    isPeriodicReading = false;
    if (periodicReadInterval) {
        clearInterval(periodicReadInterval);
        periodicReadInterval = null;
    }
    setButtonEnabled('startPeriodic', true);
    setButtonEnabled('stopPeriodic', false);
    console.log('Stopped periodic reading');
}

function autoStartPeriodicRead() {
    const svcEl = document.querySelector('#service');
    const chEl = document.querySelector('#characteristic');
    if (!svcEl || !chEl) return;
    // Restart if already running to apply new UUID/interval
    if (isPeriodicReading) {
        stopPeriodicReading();
    }
    startPeriodicReading();
}

function performPeriodicRead() {
    if (!isPeriodicReading) return;
    schedulerCallCount++; // Increment scheduler counter
    updateSchedulerCounter(); // Update display
    
    const svcEl = document.querySelector('#service');
    const chEl = document.querySelector('#characteristic');
    if (!svcEl || !chEl) {
        console.error('Service/Characteristic inputs not found in DOM');
        return;
    }
    let serviceUuid = svcEl.value;
    let characteristicUuid = chEl.value;
    // Normalize hex-style short UUID strings to numbers for Web Bluetooth
    if (serviceUuid && /^0x/i.test(serviceUuid)) serviceUuid = parseInt(serviceUuid);
    if (characteristicUuid && /^0x/i.test(characteristicUuid)) characteristicUuid = parseInt(characteristicUuid);
    const format = getValueFormat();

    ensureConnected()
        .then(() => theServer.getPrimaryService(serviceUuid))
        .then(service => service.getCharacteristic(characteristicUuid))
        .then(characteristic => {
            if (!characteristic.properties.read) {
                // Fallback: if NOTIFY is supported, subscribe and collect data from notifications
                if (characteristic.properties.notify) {
                    subscribeForCollection(characteristic, format, svcEl.value, chEl.value);
                    return Promise.resolve(null);
                }
                throw new Error('Characteristic does not support READ or NOTIFY');
            }
            return characteristic.readValue();
        })
        .then(value => {
            if (!value) {
                // Using NOTIFY fallback; data is collected in the notification handler
                return;
            }
            const timestamp = new Date();
            const hex = dataViewToHex(value);
            const decoded = decodeByFormat(value, format);
            const adcData = parseADCData(value, svcEl.value, chEl.value);

            collectedData.push({
                timestamp,
                value: decoded,
                hex,
                rawBytes: Array.from(new Uint8Array(value.buffer)),
                adcData,
            });
            updateDataPointCount();
            try {
                updateChart();
            } catch (e) {
                console.error('Chart update error:', e);
            }
        })
        .catch(err => {
            console.error('Periodic read error:', err);
        });
}

// Subscribe to notifications and collect incoming values into collectedData for charting/CSV
function subscribeForCollection(characteristic, format, serviceUuidRaw, characteristicUuidRaw) {
    try {
        // Avoid duplicate subscriptions
        if (currentNotifyCharacteristic === characteristic) return;
        // Tear down previous subscription if different characteristic
        if (currentNotifyCharacteristic && currentNotifyCharacteristic !== characteristic) {
            try {
                if (currentNotifyHandler) {
                    currentNotifyCharacteristic.removeEventListener('characteristicvaluechanged', currentNotifyHandler);
                }
                currentNotifyCharacteristic.stopNotifications().catch(() => {});
            } catch (_) {}
            currentNotifyCharacteristic = null;
            currentNotifyHandler = null;
        }

        const handler = (event) => {
            const value = event.target.value;
            const timestamp = new Date();
            const hex = dataViewToHex(value);
            const decoded = decodeByFormat(value, format);
            const adcData = parseADCData(value, serviceUuidRaw, characteristicUuidRaw);
            collectedData.push({
                timestamp,
                value: decoded,
                hex,
                rawBytes: Array.from(new Uint8Array(value.buffer)),
                adcData,
            });
            updateDataPointCount();
            try { updateChart(); } catch (_) {}
        };

        characteristic.addEventListener('characteristicvaluechanged', handler);
        characteristic.startNotifications()
            .then(() => {
                currentNotifyCharacteristic = characteristic;
                currentNotifyHandler = handler;
                console.log('Subscribed to notifications for auto-collection');
            })
            .catch(err => console.error('Notify subscribe error:', err));
    } catch (e) {
        console.error('subscribeForCollection error:', e);
    }
}

// Auto-select FFE3 service/characteristic from discovered services and start periodic collection
function autoSelectFFE3AndStart() {
    try {
        let targetService = null;
        let targetCharUuid = null;
        characteristicMap.forEach((chars, svcUuid) => {
            const s = String(svcUuid).toLowerCase();
            if (s.includes('ffe3')) {
                targetService = svcUuid;
                const readOrNotify = chars.find(c => (c.properties && (c.properties.read || c.properties.notify)));
                targetCharUuid = readOrNotify ? readOrNotify.uuid : (chars[0] && chars[0].uuid);
            }
        });

        if (!targetService || !targetCharUuid) {
            const firstService = [...characteristicMap.keys()][0];
            const firstChars = characteristicMap.get(firstService) || [];
            const firstChar = firstChars[0] && firstChars[0].uuid;
            if (!firstService || !firstChar) return;
            targetService = firstService;
            targetCharUuid = firstChar;
        }

        const serviceInput = document.getElementById('service');
        const characteristicInput = document.getElementById('characteristic');
        if (serviceInput) serviceInput.value = targetService;
        if (characteristicInput) characteristicInput.value = targetCharUuid;
        autoStartPeriodicRead();
    } catch (e) {
        console.warn('autoSelectFFE3AndStart failed:', e);
    }
}

function updateDataPointCount() {
    const el = document.getElementById('dataPointsCount');
    if (el) el.textContent = String(collectedData.length);
}

function updateSchedulerCounter() {
    const el = document.getElementById('schedulerCount');
    if (el) el.textContent = String(schedulerCallCount);
}

function initChart() {
    const canvas = document.getElementById('dataChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (dataChart) {
        dataChart.destroy();
        dataChart = null;
    }
    dataChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [],
        },
        options: {
            responsive: true,
            animation: false,
            plugins: {
                legend: { display: true },
                tooltip: { mode: 'index', intersect: false },
            },
            scales: {
                x: { title: { display: true, text: 'Time' } },
                y: { title: { display: true, text: 'Reading' } },
            },
        },
    });
}

function updateChart() {
    if (!dataChart) initChart();
    const canvas = document.getElementById('dataChart');
    if (!canvas || !dataChart) return;

    const latest = collectedData[collectedData.length - 1];
    const isADC = latest && latest.adcData && latest.adcData.length === 4;
    if (isADC) {
        updateADCChart();
    } else {
        updateRegularChart();
    }
}

function toTimeLabel(ts) {
    try {
        return ts.toLocaleTimeString();
    } catch (_) {
        return String(ts);
    }
}

function updateRegularChart() {
    if (!dataChart) return;
    const labels = collectedData.map(dp => toTimeLabel(dp.timestamp));
    const values = collectedData.map(dp => {
        const num = Number(dp.value);
        return isFinite(num) ? num : null;
    });
    if (dataChart.data.datasets.length === 0) {
        dataChart.data.datasets.push({
            label: 'Reading',
            data: [],
            borderColor: '#1976d2',
            backgroundColor: 'rgba(25, 118, 210, 0.1)',
            tension: 0.2,
        });
    }
    dataChart.data.labels = labels;
    dataChart.data.datasets[0].data = values;
    dataChart.update();
}

function updateADCChart() {
    if (!dataChart) return;
    const labels = collectedData.map(dp => toTimeLabel(dp.timestamp));
    const chData = [[], [], [], []];
    collectedData.forEach(dp => {
        const adc = dp.adcData;
        if (adc && adc.length === 4) {
            for (let i = 0; i < 4; i++) chData[i].push(adc[i].rawValue);
        } else {
            for (let i = 0; i < 4; i++) chData[i].push(null);
        }
    });
    const colors = ['#e53935', '#43a047', '#fb8c00', '#8e24aa'];
    while (dataChart.data.datasets.length < 4) {
        const idx = dataChart.data.datasets.length;
        dataChart.data.datasets.push({
            label: 'ADC CH' + (idx + 1),
            data: [],
            borderColor: colors[idx % colors.length],
            backgroundColor: 'rgba(0,0,0,0.05)',
            tension: 0.2,
        });
    }
    dataChart.data.labels = labels;
    for (let i = 0; i < 4; i++) dataChart.data.datasets[i].data = chData[i];
    dataChart.update();
}

function exportCSV() {
    let csv = 'timestamp,value,hex,ADC_CH1,ADC_CH2,ADC_CH3,ADC_CH4\n';
    collectedData.forEach(dp => {
        const ts = dp.timestamp.toISOString();
        const val = String(dp.value).replace(/"/g, '""');
        const hex = dp.hex;
        let ch = ['', '', '', ''];
        if (dp.adcData && dp.adcData.length === 4) {
            ch = dp.adcData.map(c => String(c.rawValue));
        }
        csv += `${ts},"${val}",${hex},${ch[0]},${ch[1]},${ch[2]},${ch[3]}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ble_data_${new Date().toISOString().replace(/:/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function clearData() {
    collectedData = [];
    updateDataPointCount();
    if (dataChart) {
        dataChart.data.labels = [];
        dataChart.data.datasets.forEach(ds => ds.data = []);
        dataChart.update();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Buttons may not exist; ensure no errors
    setButtonEnabled('startPeriodic', false);
    setButtonEnabled('stopPeriodic', false);
    // Init chart lazily
    initChart();
    updateDataPointCount();
    // Auto-start on manual text input changes
    const svcText = document.getElementById('service');
    const chText = document.getElementById('characteristic');
    if (svcText) svcText.addEventListener('input', autoStartPeriodicRead);
    if (chText) chText.addEventListener('input', autoStartPeriodicRead);
    // Restart on interval change
    const intervalSelect = document.getElementById('readInterval');
    if (intervalSelect) intervalSelect.addEventListener('change', autoStartPeriodicRead);
});