'use strict';

let theDevice = null;
let theServer = null;

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
        filters: [{services: services}],
        optionalServices: services
    })
    .then(device => {
        theDevice = device;
        console.log('> Found ' + device.name);
        console.log('Connecting to GATT Server...');
        device.addEventListener('gattserverdisconnected', onDisconnected)
        return device.gatt.connect();
    })
    .then(server => {
        theServer = server;
        console.log('Gatt connected');
        onConnected();

        console.log('Getting Services...');
        return server.getPrimaryServices();
    })
    .then(services => {
        console.log('Getting Characteristics...');
        let queue = Promise.resolve();
        services.forEach(service => {
          queue = queue.then(_ => service.getCharacteristics().then(characteristics => {
            console.log('> Service: ' + service.uuid);
            characteristics.forEach(characteristic => {
                console.log('>> Characteristic: ' + characteristic.uuid + ' ' +
                  getSupportedProperties(characteristic));
            });
          }));
        });
        return queue;
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

    theServer.getPrimaryService(serviceUuid)
    .then(service => {
        return service.getCharacteristic(characteristicUuid);
    })
    .then(characteristic => {
        return characteristic.readValue();
    })
    .then(value => {
        let decoder = new TextDecoder('utf-8');
        console.log('Received: ' + decoder.decode(value));
        document.querySelector('#value').value = decoder.decode(value);
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

    theServer.getPrimaryService(serviceUuid)
    .then(service => {
        return service.getCharacteristic(characteristicUuid);
    })
    .then(characteristic => {
        let encoder = new TextEncoder('utf-8');
        let value = document.querySelector('#value').value;
        return characteristic.writeValue(encoder.encode(value));
    })
    .then(_ => {
        console.log('Sent: ' + document.querySelector('#value').value);
    })
    .catch(error => {
        console.log('Argh! ' + error);
    });
}