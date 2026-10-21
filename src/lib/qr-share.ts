// qr-share — QR koda za deljenje fotomontaže/meritev s stranko
// Uporablja qrcode (client-side, brez strežnika).

import QRCode from 'qrcode'

export async function generateQrDataUrl (text: string, size: number = 200): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    color: { dark: '#1e3a5f', light: '#ffffff' },
  })
}

export async function generateQrSvg (text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1 })
}
