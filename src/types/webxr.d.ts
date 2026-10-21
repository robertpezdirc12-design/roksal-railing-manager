interface XRSession {
  requestAnimationFrame(callback: (time: number, frame: XRFrame) => void): number
  cancelAnimationFrame(handle: number): void
  end(): Promise<void>
  updateRenderState(state: any): void
  requestReferenceSpace(type: string): Promise<any>
  gl?: WebGLRenderingContext | null
  visibilityState: string
  onvisibilitychange: ((ev: Event) => void) | null
  onend: ((ev: Event) => void) | null
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

interface XRFrame {
  getViewerPose(referenceSpace: any): any
  getHitTestResults(source: any): any[]
  trackedAnchors: any
  session: XRSession
}

interface Navigator {
  xr?: {
    requestSession(mode: string, init?: any): Promise<XRSession>
    isSessionSupported(mode: string): Promise<boolean>
  }
}

interface BluetoothDevice {
  name: string | null
  gatt?: {
    connect(): Promise<BluetoothRemoteGATTServer>
    connected: boolean
    disconnect(): void
  } | null
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

interface BluetoothRemoteGATTServer {
  connected: boolean
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>
  disconnect(): void
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTCharacteristic {
  value: DataView | null
  startNotifications(): Promise<void>
  stopNotifications(): Promise<void>
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

interface Navigator {
  bluetooth?: {
    requestDevice(options: any): Promise<BluetoothDevice>
  }
}
