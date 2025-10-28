'use strict';

let theDevice = null;
let theServer = null;
let characteristicMap = new Map();

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
    .then(() => {
        console.log('Getting Services...');
        return theServer.getPrimaryServices().catch(async (err) => {
            console.log('Service list retrieval failed, checking connection...', err);
            if (theDevice && theDevice.gatt && !theDevice.gatt.connected) {
                console.log('Reconnecting to GATT server...');
                theServer = await theDevice.gatt.connect();
                console.log('Reconnected. Retrying services discovery...');
                return theServer.getPrimaryServices();
            }
            throw err;
        });
    })
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
        const decoded = decodeByFormat(value, format);
        console.log('Received (' + format + '): ' + decoded);
        document.querySelector('#value').value = decoded;
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
    ensureConnected()
    .then(() => theServer.getPrimaryService(serviceUuid))
    .then(service => {
        return service.getCharacteristic(characteristicUuid);
    })
    .then(async characteristic => {
        const input = document.querySelector('#value').value;
        const bytes = encodeByFormat(input, format);

        // Prefer the method that matches characteristic capabilities
        if (characteristic.properties.write && typeof characteristic.writeValueWithResponse === 'function') {
            console.log('Writing WITH response:', bytes);
            return characteristic.writeValueWithResponse(bytes);
        }
        if (characteristic.properties.writeWithoutResponse && typeof characteristic.writeValueWithoutResponse === 'function') {
            console.log('Writing WITHOUT response:', bytes);
            return characteristic.writeValueWithoutResponse(bytes);
        }
        // Fallback for older implementations
        console.log('Writing (generic):', bytes);
        return characteristic.writeValue(bytes);
    })
    .then(_ => {
        console.log('Sent value successfully');
    })
    .catch(error => {
        console.log('Argh! ' + error);
    });
}