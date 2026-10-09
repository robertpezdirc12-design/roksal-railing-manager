import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/invoices/eslog — izvoz računa v eSLOG XML (UBL 2.1 Invoice, route-map: GET /api/invoices/eslog)
// Vrata: invoices.read. Vrača application/xml z attachment glavo. Revizija: ESLOG_EXPORT.
// Sklic po modelu SI12 (modul 97).

const SUPPLIER = {
  name: 'ROKSAL d.o.o.',
  street: 'Lesarska cesta 12',
  city: 'Slovenj Graddek',
  postal: '2380',
  country: 'SI',
  vatId: 'SI12345678',
  email: 'info@roksal.si',
  phone: '+386 1 234 56 78',
}

const isoDate = (d: Date | string | null | undefined): string => {
  if (!d) return ''
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10)
}

const dec2 = (n: number | null | undefined): string => (n ?? 0).toFixed(2)

/** XML escape — simboli <>&"' v besedilu. */
function esc (s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Sklic po modelu SI12: "SI12" + vsebina + 2 kontrolni števki (98 − vsebina mod 97). */
function sklicSI12 (invoiceCode: string): string {
  const digits = invoiceCode.replace(/\D/g, '') || '1'
  const base = digits.slice(-12).padStart(4, '0')
  const mod = Number(base) % 97
  const check = String(98 - mod).padStart(2, '0')
  return `SI12 ${base} ${check}`
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'invoices.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return jsonError(400, 'Manjka parameter id (račun).')

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      project: { select: { code: true, title: true, customer: { select: { name: true, address: true, city: true, taxId: true, email: true } } } },
      quote: { select: { lines: { orderBy: { id: 'asc' as const }, select: { description: true, qty: true, unitPrice: true, total: true } } } },
    },
  })
  if (!invoice) return jsonError(404, 'Račun ne obstaja.')

  const customer = invoice.project?.customer ?? null
  const ref = sklicSI12(invoice.code)

  const quoteLines = invoice.quote?.lines ?? []
  const lines = quoteLines.length > 0
    ? quoteLines
    : [{ description: `${invoice.code} — izdelava in montaža ograj (skupno)`, qty: 1, unitPrice: invoice.subtotal, total: invoice.subtotal }]

  const lineXml = lines.map((ln, i) => [
    '  <cac:InvoiceLine>',
    `    <cbc:ID>${i + 1}</cbc:ID>`,
    `    <cbc:InvoicedQuantity unitCode="MTR">${(ln.qty ?? 1).toFixed(2)}</cbc:InvoicedQuantity>`,
    `    <cbc:LineExtensionAmount currencyID="EUR">${dec2(ln.total.toNumber())}</cbc:LineExtensionAmount>`,
    '    <cac:Item>',
    `      <cbc:Name>${esc(ln.description)}</cbc:Name>`,
    '    </cac:Item>',
    '    <cac:Price>',
    `      <cbc:PriceAmount currencyID="EUR">${dec2(ln.unitPrice.toNumber())}</cbc:PriceAmount>`,
    '    </cac:Price>',
    '  </cac:InvoiceLine>',
  ].join('\n')).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:roksal:eslog:2.0.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:roksal:railing-manager</cbc:ProfileID>
  <cbc:ID>${esc(invoice.code)}</cbc:ID>
  <cbc:IssueDate>${isoDate(invoice.createdAt)}</cbc:IssueDate>
  <cbc:DueDate>${isoDate(invoice.dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(SUPPLIER.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(SUPPLIER.street)}</cbc:StreetName>
        <cbc:CityName>${esc(SUPPLIER.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(SUPPLIER.postal)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${SUPPLIER.country}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(SUPPLIER.vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:ElectronicMail>${esc(SUPPLIER.email)}</cbc:ElectronicMail>
        <cbc:Telephone>${esc(SUPPLIER.phone)}</cbc:Telephone>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(customer?.name ?? 'Neznana stranka')}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(customer?.address ?? '—')}</cbc:StreetName>
        <cbc:CityName>${esc(customer?.city ?? '—')}</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>SI</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(customer?.taxId ?? '')}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>SI56 0201 0001 2345 678</cbc:ID>
      <cbc:Name>${esc(SUPPLIER.name)}</cbc:Name>
    </cac:PayeeFinancialAccount>
    <cbc:PaymentID>${esc(ref)}</cbc:PaymentID>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${dec2(invoice.vat.toNumber())}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${dec2(invoice.subtotal.toNumber())}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${dec2(invoice.vat.toNumber())}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>22.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${dec2(invoice.subtotal.toNumber())}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${dec2(invoice.subtotal.toNumber())}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${dec2(invoice.total.toNumber())}</cbc:TaxInclusiveAmount>
    <cbc:PrepaidAmount currencyID="EUR">${dec2(invoice.paid.toNumber())}</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="EUR">${dec2(Math.max(0, invoice.total.toNumber() - invoice.paid.toNumber()))}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lineXml}
</Invoice>
`

  await writeAudit({
    userId: user.id, action: 'ESLOG_EXPORT', entity: 'invoice', entityId: invoice.id,
    detail: { code: invoice.code, format: 'eSLOG/UBL 2.1' },
  })

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${invoice.code}-eslog.xml"`,
    },
  })
}
