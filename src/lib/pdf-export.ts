// pdf-export — branded PDF izvoz za Roksal (fotomontaža, meritve, ponudbe)
// Uporablja jsPDF (client-side, brez strežnika).

import jsPDF from 'jspdf'

export interface PdfHeader {
  title: string
  subtitle?: string
  projectCode?: string
  projectName?: string
  date?: string
}

export function createBrandedPdf (header: PdfHeader): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  // Roksal header
  doc.setFillColor(30, 58, 95) // navy
  doc.rect(0, 0, pageW, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('ROKSAL', 15, 12)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Upravljanje ograj — projekti, teren, proizvodnja', 15, 18)

  // Title
  doc.setTextColor(30, 58, 95)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(header.title, 15, 40)

  if (header.subtitle) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 100, 100)
    doc.text(header.subtitle, 15, 46)
  }

  // Project info
  let y = 55
  if (header.projectCode || header.projectName) {
    doc.setFontSize(10)
    doc.setTextColor(60, 60, 60)
    if (header.projectCode) {
      doc.text(`Projekt: ${header.projectCode}`, 15, y)
      y += 5
    }
    if (header.projectName) {
      doc.text(`Naziv: ${header.projectName}`, 15, y)
      y += 5
    }
  }
  if (header.date) {
    doc.text(`Datum: ${header.date}`, 15, y)
    y += 5
  }

  // Separator
  doc.setDrawColor(200, 200, 200)
  doc.line(15, y + 2, pageW - 15, y + 2)

  return doc
}

export function addImageToPdf (doc: jsPDF, imageDataUrl: string, y: number, maxW: number = 180): number {
  try {
    const img = new Image()
    img.src = imageDataUrl
    // Calculate aspect ratio
    const aspectRatio = img.naturalWidth / img.naturalHeight || 1
    const w = Math.min(maxW, img.naturalWidth * 0.264583) // px to mm
    const h = w / aspectRatio
    doc.addImage(imageDataUrl, 'JPEG', 15, y, w, h)
    return y + h + 5
  } catch {
    return y + 5
  }
}

export function addTextToPdf (doc: jsPDF, text: string, y: number, fontSize: number = 10): number {
  doc.setFontSize(fontSize)
  doc.setTextColor(60, 60, 60)
  const lines = doc.splitTextToSize(text, 180)
  doc.text(lines, 15, y)
  return y + lines.length * (fontSize * 0.35) + 3
}

export function savePdf (doc: jsPDF, filename: string): void {
  doc.save(filename)
}
