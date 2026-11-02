const { getMachine } = require('../cutters/catalog.cjs');
function bifrostMachine(id) {
  const machine = getMachine(id);
  if (machine.provider !== 'cricut' || machine.driver !== 'bifrost' || !machine.directConnect)
    throw Error(machine.unavailableReason || 'This machine has no direct Cricut driver.');
  return machine;
}
function createDevice(B, machine, connection) {
  const factory = B[machine.deviceClass];
  if (typeof factory?.createDevice !== 'function')
    throw Error(`The installed Cricut runtime does not support ${machine.name}.`);
  return factory.createDevice(connection);
}
function matchesDescriptor(B, machine, transport, descriptor) {
  try {
    const type =
      transport === 'usb'
        ? B.DeviceType.fromUsbSerialDescriptor({
            vid: descriptor.vendorId,
            pid: descriptor.productId,
            serialNumber: descriptor.serialNumber,
          })
        : B.DeviceType.fromBluetoothLeDescriptor({
            localName: descriptor.localName,
            manufacturerData: descriptor.manufacturerData.buffer.slice(
              descriptor.manufacturerData.byteOffset,
              descriptor.manufacturerData.byteOffset + descriptor.manufacturerData.byteLength,
            ),
          });
    return type === machine.deviceType;
  } catch {
    return false;
  }
}
module.exports = { bifrostMachine, createDevice, matchesDescriptor };
