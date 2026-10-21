// laser-meter — Web Bluetooth API za povezavo z laser metri (Leica DISTO, Bosch GLM, Hilti)
// Brezplačno, deluje v Chrome na Androidu in (omejeno) Safari na iOS.
// Protokol: GATT — standardni Bluetooth Low Energy.
//
// Podprti naprave:
//   - Leica DISTO (BLE GATT service 0xFFF0, characteristic 0xFFF1)
//   - Bosch GLM (BLE GATT service 0xFFB0, characteristic 0xFFB1)
//   - Generični laser meter (standardna GATT distance service)

export type LaserDevice = 'leica' | 'bosch' | 'generic' | 'unknown'

export interface LaserReading {
  distance: number // metri
  timestamp: number
  device: LaserDevice
  battery?: number // 0-100
}

export interface LaserMeterState {
  connected: boolean
  device: LaserDevice
  name: string | null
  lastReading: LaserReading | null
  error: string | null
}

// GATT service/characteristic UUID-ji za znane naprave
const LEICA_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb'
const LEICA_CHAR = '0000fff1-0000-1000-8000-00805f9b34fb'
const BOSCH_SERVICE = '0000ffb0-0000-1000-8000-00805f9b34fb'
const BOSCH_CHAR = '0000ffb1-0000-1000-8000-00805f9b34fb'

// Generični GATT distance service (Bluetooth SIG standard)
const GENERIC_DISTANCE_SERVICE = '0000181c-0000-1000-8000-00805f9b34fb' // Environmental Sensing
const GENERIC_DISTANCE_CHAR = '00002a6c-0000-1000-8000-00805f9b34fb' // Distance

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export async function requestLaserDevice(): Promise<BluetoothDevice | null> {
  if (!isBluetoothSupported()) return null
  try {
    const device = await (navigator as any).bluetooth.requestDevice({
      filters: [
        { services: [LEICA_SERVICE] },
        { services: [BOSCH_SERVICE] },
        { services: [GENERIC_DISTANCE_SERVICE] },
        { namePrefix: 'DISTO' },
        { namePrefix: 'GLM' },
        { namePrefix: 'Leica' },
        { namePrefix: 'Bosch' },
      ],
      optionalServices: [LEICA_SERVICE, BOSCH_SERVICE, GENERIC_DISTANCE_SERVICE],
    })
    return device
  } catch {
    return null
  }
}

export function detectDevice(name: string | null): LaserDevice {
  if (!name) return 'unknown'
  const lower = name.toLowerCase()
  if (lower.includes('disto') || lower.includes('leica')) return 'leica'
  if (lower.includes('glm') || lower.includes('bosch')) return 'bosch'
  return 'generic'
}

export async function connectAndRead(
  device: BluetoothDevice,
  onReading: (reading: LaserReading) => void,
  onError: (error: string) => void
): Promise<() => void> {
  const deviceType = detectDevice(device.name)
  let serviceUUID: string
  let charUUID: string

  switch (deviceType) {
    case 'leica':
      serviceUUID = LEICA_SERVICE
      charUUID = LEICA_CHAR
      break
    case 'bosch':
      serviceUUID = BOSCH_SERVICE
      charUUID = BOSCH_CHAR
      break
    default:
      serviceUUID = GENERIC_DISTANCE_SERVICE
      charUUID = GENERIC_DISTANCE_CHAR
  }

  try {
    const server = await device.gatt!.connect()
    const service = await server.getPrimaryService(serviceUUID)
    const characteristic = await service.getCharacteristic(charUUID)

    const handler = (event: Event) => {
      const target = event.target as unknown as BluetoothRemoteGATTCharacteristic
      const value = target.value
      if (!value) return

      // Parse distance from bytes (little-endian float32 for Leica/Bosch)
      let distance = 0
      if (value.byteLength >= 4) {
        const view = new DataView(value.buffer)
        distance = view.getFloat32(0, true) // little-endian
      } else if (value.byteLength >= 2) {
        const view = new DataView(value.buffer)
        distance = view.getUint16(0, true) / 100 // cm → m
      }

      if (distance > 0 && distance < 100) {
        onReading({
          distance,
          timestamp: Date.now(),
          device: deviceType,
        })
      }
    }

    await characteristic.startNotifications()
    characteristic.addEventListener('characteristicvaluechanged', handler)

    // Cleanup function
    return () => {
      characteristic.removeEventListener('characteristicvaluechanged', handler)
      characteristic.stopNotifications().catch(() => {})
      if (device.gatt?.connected) device.gatt.disconnect()
    }
  } catch (err) {
    onError(`Povezava ni uspela: ${err instanceof Error ? err.message : String(err)}`)
    return () => {}
  }
}

export function formatDistance(meters: number): string {
  if (meters < 1) return `${(meters * 100).toFixed(1)} cm`
  return `${meters.toFixed(3)} m`
}
