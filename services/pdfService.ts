import { normalFont,boldFont } from '../assets/pdfFonts';
import { jsPDF } from "jspdf";
import { getRecordedReserveSplit, getRecordedReserveTotal } from '../utils/security';
import type {
  Invoice,
  Building,
  Resident,
  Syndic,
  Quittance,
  AssembleeGenerale,
  Apartment,
  Transaction,
  Prestataire,
  Charge,
  MaintenanceRequest,
  Document as BuildingDocument,
} from "../types";

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  minimumFractionDigits: 2,
});

(jsPDF.API as any).events.push(['addFonts',function(this:jsPDF){this.addFileToVFS('ImmoGest-Regular.ttf',normalFont);this.addFileToVFS('ImmoGest-Bold.ttf',boldFont);for(const style of ['normal','italic'])this.addFont('ImmoGest-Regular.ttf','helvetica',style);for(const style of ['bold','bolditalic'])this.addFont('ImmoGest-Bold.ttf','helvetica',style);}]);
// Helper to convert numbers to French words for formal receipts
function numberToFrenchWords(amount: number): string {
  const integerPart = Math.floor(amount);
  const decimalPart = Math.round((amount - integerPart) * 100);

  const units = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
                 "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
  const tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante-dix", "quatre-vingts", "quatre-vingt-dix"];

  function convertChunk(n: number): string {
    if (n === 0) return "";
    if (n < 20) return units[n];
    if (n < 100) {
      const ten = Math.floor(n / 10);
      const unit = n % 10;
      if (ten === 7) return "soixante-" + (unit === 1 ? "et-onze" : units[10 + unit]);
      if (ten === 9) return "quatre-vingt-" + units[10 + unit];
      if (unit === 0) return tens[ten];
      if (unit === 1) return tens[ten] + "-et-un";
      return tens[ten] + "-" + units[unit];
    }
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    const hundredStr = hundred === 1 ? "cent" : units[hundred] + " cent" + (hundred > 1 && rest === 0 ? "s" : "");
    if (rest === 0) return hundredStr;
    return hundredStr + " " + convertChunk(rest);
  }

  function convert(n: number): string {
    if (n === 0) return "zéro";
    if (n < 1000) return convertChunk(n);
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const thousandStr = thousands === 1 ? "mille" : convertChunk(thousands) + " mille";
    if (rest === 0) return thousandStr;
    return thousandStr + " " + convertChunk(rest);
  }

  const intWords = convert(integerPart);
  let res = intWords + " dirhams";
  if (decimalPart > 0) {
    res += " et " + convert(decimalPart) + " centimes";
  }
  return res.charAt(0).toUpperCase() + res.slice(1);
}

// 1. GENERATE INVOICE PDF
export const generateInvoicePDF = (invoice: Invoice, building: Building, resident: Resident, syndic?: Syndic) => {
  const doc=new jsPDF(),recipient=invoice.issuedTo||resident;
  const header=()=>{doc.setFillColor(15,118,110);doc.rect(0,0,210,32,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('AVIS DE CHARGES',14,19);doc.setFontSize(9);doc.text(invoice.invoiceNumber,196,19,{align:'right'});doc.setTextColor(30,41,59);doc.setFont('helvetica','normal');doc.setFontSize(10);};
  header();doc.setFont('helvetica','normal');doc.setFontSize(10);let y=44;
  const write=(value:string,width=180)=>{const lines=doc.splitTextToSize(value,width);for(const line of lines){if(y>267){doc.addPage();header();y=44;}doc.text(line,14,y);y+=5;}y+=2;};
  write(`${syndic?.name||'Syndic'} · ${building.name}`);write(`${building.address||'Adresse à renseigner'} · ${building.city||''}`);write(`Destinataire : ${recipient.name}`);write(`Émis le ${new Date(invoice.createdAt).toLocaleDateString('fr-MA')} · Échéance ${new Date(invoice.dueDate).toLocaleDateString('fr-MA')}`);y+=4;
  const items=invoice.items?.length?invoice.items:[{description:'Charges de copropriété',period:'',amount:invoice.totalAmount}];
  for(const item of items){const lines=doc.splitTextToSize(`${item.description}${item.period?' · '+item.period:''}`,135);if(y+lines.length*5>247){doc.addPage();header();y=44;}for(const [index,line] of lines.entries()){if(y>247){doc.addPage();header();y=44;}doc.text(line,14,y);if(index===0)doc.text(currencyFormatter.format(item.amount),196,y,{align:'right'});y+=5;}y+=3;}
  y+=5;write(`Montant facturé : ${currencyFormatter.format(invoice.totalAmount)}`);write(`Déjà réglé : ${currencyFormatter.format(invoice.paidAmount||0)}`);doc.setFont('helvetica','bold');write(`Reste à payer : ${currencyFormatter.format(Math.max(0,invoice.totalAmount-(invoice.paidAmount||0)))}`);doc.setFont('helvetica','normal');y+=6;write(`Banque : ${building.bankName||syndic?.bankName||'Non renseignée - contacter le syndic'}`);write(`RIB : ${building.bankRib||syndic?.rib||'Non renseigné - contacter le syndic'}`);write(`Référence du virement : ${invoice.invoiceNumber}`);
  for(let page=1;page<=doc.getNumberOfPages();page++){doc.setPage(page);doc.setFontSize(8);doc.text(`${page} / ${doc.getNumberOfPages()}`,196,285,{align:'right'});}
  doc.save(`Avis_Charges_${invoice.invoiceNumber}.pdf`);return doc;
};

// 2. GENERATE OFFICIAL MOROCCAN QUITTANCE DE PAIEMENT (Loi 18-00 & Loi 106-12)
export const generateQuittancePDF = (
  quittance: Quittance,
  building: Building,
  syndic?: Syndic,
  apartment?: Apartment,
  resident?: Resident,
  options: { autoDownload?: boolean } = { autoDownload: true }
) => {
  const doc=new jsPDF(),q=quittance as any;
  doc.setFillColor(15,118,110);doc.rect(0,0,210,34,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text(q.voidedAt?'QUITTANCE ANNULÉE':'QUITTANCE DE PAIEMENT',14,18);doc.setFontSize(10);doc.text(String(quittance.quittanceNumber),14,27);doc.setTextColor(30,41,59);doc.setFont('helvetica','normal');doc.setFontSize(10);let y=48;
  const write=(label:string,value:any)=>{const lines=doc.splitTextToSize(`${label} : ${value||'Non renseigné'}`,180);if(y+lines.length*6>265){doc.addPage();y=24;}doc.text(lines,14,y);y+=lines.length*6+5;};
  write('Syndic',syndic?.name||building.managerName);write('Immeuble',`${building.name} · ${building.address||''} · ${building.city||''}`);write('Résident',resident?.name||quittance.residentName);write('Lot',apartment?.number||quittance.apartmentNumber);write('Période couverte',quittance.periodCovered);write('Date du paiement',new Date(quittance.paymentDate).toLocaleDateString('fr-MA'));write('Mode de règlement',quittance.paymentMethod);write('Référence du règlement',quittance.referenceNumber||q.paymentId);write('Identifiant du reçu',quittance.id);
  const allocation = getRecordedReserveSplit(quittance);
  doc.setFont('helvetica','bold');write('Montant enregistré',currencyFormatter.format(quittance.amount));doc.setFont('helvetica','normal');write('Fonds courant',allocation ? currencyFormatter.format(allocation.chargesCourantesAmount) : 'Non documenté');write('Fonds de réserve',allocation ? currencyFormatter.format(allocation.reserveFundAmount) : 'Non documenté');
  if(q.voidedAt){write('Annulation',new Date(q.voidedAt).toLocaleDateString('fr-MA'));write('Motif',q.voidReason);}else{y+=6;write('Signature du syndic','________________________________');}
  doc.setFontSize(8);doc.setTextColor(100,116,139);doc.text('Reçu établi à partir du règlement enregistré dans ImmoGest.',14,285);
  const fileName=`Quittance_${quittance.quittanceNumber}_Lot_${quittance.apartmentNumber.replace(/\s+/g,'_')}.pdf`;if(options.autoDownload!==false)doc.save(fileName);return{doc,fileName,outputBlobUri:()=>doc.output('bloburl')};
};

// 3. GENERATE MISE EN DEMEURE (Article 25 de la Loi 18-00)
export const generateMiseEnDemeurePDF = (resident: Resident, apartment: Apartment, building: Building, unpaidAmount: number, syndic?: Syndic) => {
  const doc = new jsPDF();

  // Header
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("LETTRE RECOMMANDÉE AVEC ACCUSÉ DE RÉCEPTION", 14, 18);
  doc.text("VALANT MISE EN DEMEURE", 14, 23);

  // Sender (Syndic)
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text(syndic?.name || "Le Syndic de Copropriété", 14, 38);
  doc.setFont("helvetica", "normal");
  doc.text(`Immeuble ${building.name}`, 14, 43);
  doc.text(building.address, 14, 48);
  doc.text(building.city, 14, 53);

  // Recipient
  doc.setFont("helvetica", "bold");
  doc.text(`À l'attention de M./Mme ${resident.name}`, 120, 50);
  doc.setFont("helvetica", "normal");
  doc.text(`Copropriétaire de l'appartement N° ${apartment.number}`, 120, 56);
  doc.text(`Immeuble ${building.name}`, 120, 61);
  doc.text(building.city, 120, 66);

  // City & Date
  doc.text(`Fait à ${building.city}, le ${new Date().toLocaleDateString('fr-MA')}`, 14, 78);

  // Subject line
  doc.setFont("helvetica", "bold");
  doc.text("Objet : MISE EN DEMEURE POUR NON-PAIEMENT DES CHARGES DE COPROPRIÉTÉ", 14, 88);
  doc.setFont("helvetica", "normal");
  doc.text("Réf légale : Article 25 de la Loi n° 18-00 relative à la copropriété des immeubles bâtis", 14, 94);

  // Body
  let y = 108;
  doc.text("Madame, Monsieur,", 14, y);

  y += 10;
  const paragraph1 = `En votre qualité de copropriétaire du lot N° ${apartment.number} au sein de la résidence ${building.name}, nous constatons qu'en dépit de nos précédents rappels amiables, votre compte de charges présente à ce jour un solde débiteur impayé de :`;
  const splitP1 = doc.splitTextToSize(paragraph1, 182);
  doc.text(splitP1, 14, y);

  y += 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(185, 28, 28); // Red
  doc.text(currencyFormatter.format(unpaidAmount) + ` (${numberToFrenchWords(unpaidAmount)})`, 14, y);

  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  const paragraph2 = `Par la présente, nous vous METTONS FORMELLEMENT EN DEMEURE de procéder au règlement intégral de cette somme dans un DÉLAI STRICT DE TRENTE (30) JOURS à compter de la réception de la présente lettre.`;
  const splitP2 = doc.splitTextToSize(paragraph2, 182);
  doc.text(splitP2, 14, y);

  y += 20;
  const paragraph3 = `À défaut de règlement dans ce délai légal imparti par l'article 25 de la Loi 18-00, nous serons dans l'obligation de saisir Monsieur le Président du Tribunal de Première Instance territorialement compétent afin d'obtenir une ORDONNANCE D'INJONCTION DE PAYER avec exécution provisoire.`;
  const splitP3 = doc.splitTextToSize(paragraph3, 182);
  doc.text(splitP3, 14, y);

  y += 24;
  const paragraph4 = `Tous les frais de procédure, dépens et intérêts de retard seront intégralement mis à votre charge. Vous pouvez vous libérer par virement sur le compte bancaire de la copropriété : ${building.bankRib || "compte bancaire habituel du syndicat"}.`;
  const splitP4 = doc.splitTextToSize(paragraph4, 182);
  doc.text(splitP4, 14, y);

  y += 20;
  doc.text("Dans l'attente de votre régularisation, nous vous prions d'agréer nos salutations distinguées.", 14, y);

  y += 20;
  doc.setFont("helvetica", "bold");
  doc.text("Le Syndic de Copropriété", 140, y);
  doc.setFont("helvetica", "normal");
  doc.text("[Signature & Cachet]", 140, y + 16);

  doc.save(`Mise_En_Demeure_${resident.name.replace(/\s+/g, '_')}_Apt_${apartment.number}.pdf`);
};

// 4. GENERATE PROCÈS-VERBAL D'ASSEMBLÉE GÉNÉRALE (PV AG)
export const generatePvAgPDF = (ag: AssembleeGenerale, building: Building, syndic?: Syndic) => {
  const doc = new jsPDF();

  // Header
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`PROCÈS-VERBAL D'ASSEMBLÉE GÉNÉRALE (${ag.type})`, 105, 18, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Copropriété : ${building.name} - ${building.city}`, 105, 26, { align: 'center' });

  let y = 44;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Date et heure : Le ${ag.date} à ${ag.time}`, 14, y);
  doc.text(`Lieu de réunion : ${ag.location}`, 14, y + 6);
  doc.text(`Président de séance : ${ag.presidentName || "Élu en séance"}`, 14, y + 12);
  doc.text(`Secrétaire de séance : ${ag.secretaryName || syndic?.name || "Le Syndic"}`, 14, y + 18);

  // Quorum section
  y += 28;
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 18, 'F');
  doc.setFont("helvetica", "bold");
  doc.text("CONSTATATION DU QUORUM LÉGAL (Loi 18-00 / Loi 106-12) :", 18, y + 6);
  doc.setFont("helvetica", "normal");
  const quorumText = `Tantièmes présents et représentés : ${ag.presentTantiemes} / ${ag.totalTantiemes} tantièmes (${Math.round((ag.presentTantiemes / ag.totalTantiemes) * 100)}%).`;
  doc.text(quorumText, 18, y + 12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(ag.quorumReached ? 15 : 185, ag.quorumReached ? 118 : 28, ag.quorumReached ? 110 : 28);
  doc.text(ag.quorumReached ? "-> QUORUM ATTEINT : L'Assemblée peut valablement délibérer." : "-> QUORUM NON ATTEINT : Deuxième convocation requise.", 115, y + 12);

  // Order of business
  y += 26;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text("ORDRE DU JOUR :", 14, y);
  doc.setFont("helvetica", "normal");
  ag.agendaItems.forEach((item, index) => {
    y += 6;
    doc.text(`${index + 1}. ${item}`, 18, y);
  });

  // Resolutions & Votes
  y += 12;
  doc.setFont("helvetica", "bold");
  doc.text("DÉLIBÉRATIONS ET VOTES DES RÉSOLUTIONS :", 14, y);

  ag.resolutions.forEach((res) => {
    y += 10;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFillColor(248, 250, 252);
    doc.rect(14, y, 182, 22, 'F');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(`Résolution N° ${res.number} : ${res.title}`, 18, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(res.description, 18, y + 11);
    doc.setFont("helvetica", "bold");
    doc.text(`Votes : POUR : ${res.votesFor} tantièmes  |  CONTRE : ${res.votesAgainst}  |  ABSTENTION : ${res.votesAbstain}`, 18, y + 17);
    doc.setTextColor(res.status === 'approved' ? 15 : 185, res.status === 'approved' ? 118 : 28, res.status === 'approved' ? 110 : 28);
    doc.text(`RÉSULTAT : ${res.status === 'approved' ? "ADOPTÉE" : "REJETÉE"}`, 145, y + 17);
    doc.setTextColor(15, 23, 42);
    y += 14;
  });

  // Signatures
  y += 15;
  if (y > 240) {
    doc.addPage();
    y = 20;
  }
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Le Président de séance", 25, y);
  doc.text("Le Secrétaire de séance", 85, y);
  doc.text("Le Syndic", 150, y);

  doc.setFont("helvetica", "normal");
  doc.text("(Signature)", 25, y + 14);
  doc.text("(Signature)", 85, y + 14);
  doc.text("(Signature & Cachet)", 150, y + 14);

  doc.save(`PV_Assemblee_Generale_${building.name.replace(/\s+/g, '_')}_${ag.date}.pdf`);
};

// 5. GENERATE TRANSACTION ACCOUNTING VOUCHER (PIÈCE COMPTABLE LOI 18-00)
export const generateTransactionVoucherPDF = (
  trx: Transaction,
  building: Building,
  syndic?: Syndic
) => {
  const doc = new jsPDF();
  const isIncome = trx.amount >= 0 || trx.type === 'income';
  const absAmount = Math.abs(trx.amount);

  // Top header banner
  doc.setFillColor(isIncome ? 13 : 30, isIncome ? 148 : 41, isIncome ? 136 : 59); // Teal 600 or Slate 800
  doc.rect(0, 0, 210, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(
    isIncome ? "PIÈCE COMPTABLE : REÇU D'ENCAISSEMENT" : "PIÈCE COMPTABLE : BORDEREAU DE DÉPENSE",
    14,
    20
  );
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.text("Conformité Comptabilité Syndic · Loi 18-00 relative à la copropriété", 14, 27);

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(`Réf Écriture : ${trx.id}`, 145, 16);
  doc.setFont("helvetica", "normal");
  doc.text(`Date : ${new Date(trx.date).toLocaleDateString('fr-MA')}`, 145, 22);
  doc.text(`Fonds : ${trx.fundType === 'reserve' ? 'FONDS DE RÉSERVE (Loi 106-12)' : 'COMPTE COURANT'}`, 145, 28);

  // General details
  doc.setTextColor(15, 23, 42);
  let y = 48;

  // Syndic & Copropriété box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(14, y, 88, 38, 'FD');

  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.text("SYNDICAT DES COPROPRIÉTAIRES :", 18, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Résidence : ${building.name}`, 18, y + 14);
  doc.text(`Adresse : ${building.address}, ${building.city}`, 18, y + 20);
  doc.text(`Gestionnaire : ${syndic?.name || building.managerName || 'Syndic'}`, 18, y + 26);
  if (building.bankName) doc.text(`Banque : ${building.bankName}`, 18, y + 32);

  // Third party box (Prestataire ou Copropriétaire)
  doc.rect(108, y, 88, 38, 'FD');
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.text(isIncome ? "PAYEUR / COPROPRIÉTAIRE :" : "BÉNÉFICIAIRE / PRESTATAIRE :", 112, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Nom : ${trx.thirdPartyName || (isIncome ? 'Copropriétaire' : 'Fournisseur')}`, 112, y + 14);
  if (trx.thirdPartyIce) {
    doc.text(`ICE (Entr.) : ${trx.thirdPartyIce}`, 112, y + 20);
  } else if (trx.lotNumber) {
    doc.text(`Lot / Apt : ${trx.lotNumber}`, 112, y + 20);
  }
  doc.text(`Mode : ${trx.paymentMethod ? trx.paymentMethod.toUpperCase() : 'VIREMENT'}`, 112, y + 26);
  if (trx.reference) {
    doc.text(`Réf / Chèque N° : ${trx.reference}`, 112, y + 32);
  }

  // Voucher details box
  y = 94;
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 9, 'F');
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("DÉTAIL DE L'OPÉRATION COMPTABLE", 18, y + 6);
  doc.text("MONTANT NET", 155, y + 6);

  y += 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(trx.description, 18, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(currencyFormatter.format(absAmount), 155, y);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Catégorie comptable : ${trx.category || 'Général'}`, 18, y);
  if (trx.documentType || trx.invoiceNumber) {
    doc.text(
      `Pièce justificative : ${trx.documentType ? trx.documentType.toUpperCase() : 'PIÈCE'} ${
        trx.invoiceNumber ? 'N° ' + trx.invoiceNumber : ''
      }`,
      18,
      y + 6
    );
    y += 6;
  }
  if (trx.notes) {
    doc.text(`Observations / Résolution : ${trx.notes}`, 18, y + 6);
    y += 6;
  }

  // Amount in letters box
  y += 14;
  doc.setFillColor(254, 252, 232); // Amber 50
  doc.setDrawColor(254, 240, 138); // Amber 200
  doc.rect(14, y, 182, 18, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("MONTANT TOTAL ARRETÉ EN TOUTES LETTRES :", 18, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(numberToFrenchWords(absAmount), 18, y + 12);

  // Legal declaration
  y += 26;
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "Le présent document tient lieu de justificatif d'écriture comptable pour le syndicat des copropriétaires conformément aux dispositions",
    14,
    y
  );
  doc.text(
    "de la Loi 18-00 régissant la copropriété des immeubles bâtis au Royaume du Maroc et de la Loi 106-12 relative aux fonds de réserve.",
    14,
    y + 4
  );

  // Signatures
  y += 18;
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 56, 32);
  doc.rect(77, y, 56, 32);
  doc.rect(140, y, 56, 32);

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("VISA DU SYNDIC", 18, y + 6);
  doc.text("BÉNÉFICIAIRE / TIERS", 81, y + 6);
  doc.text("CONSEIL SYNDICAL", 144, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text("(Cachet et Signature)", 18, y + 26);
  doc.text("(Émargement / Reçu)", 81, y + 26);
  doc.text("(Vérification comptes)", 144, y + 26);

  doc.save(`Piece_Comptable_${trx.id}_${trx.date.split('T')[0]}.pdf`);
};

// Helper to trigger browser download of a UTF-8 CSV file (with BOM for Excel compatibility)
const downloadCSVFile = (csvContent: string, fileName: string) => {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const escapeCSVCell = (value: string | number | undefined | null): string => {
  if (value === null || value === undefined) return '""';
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
};

const COPRO_TYPE_LABELS: Record<string, string> = {
  apartment: 'Appartement',
  duplex: 'Duplex / Penthouse',
  commercial: 'Local Commercial',
  parking: 'Parking',
  box: 'Box / Garage',
};

// 6. EXPORT RESIDENT LIST AS CSV
export const exportResidentsCSV = (building: Building) => {
  const aptByResidentId = new Map<string, Apartment>();
  building.apartments.forEach((apt) => {
    if (apt.ownerId) aptByResidentId.set(apt.ownerId, apt);
    if (apt.tenantId) aptByResidentId.set(apt.tenantId, apt);
  });
  building.residents.forEach((res) => {
    if (res.apartmentId && !aptByResidentId.has(res.id)) {
      const found = building.apartments.find((a) => a.id === res.apartmentId);
      if (found) aptByResidentId.set(res.id, found);
    }
  });

  const headers = [
    'Immeuble',
    'Ville',
    'Nom Complet',
    'N° CIN',
    'Qualité / Rôle',
    'Lot Assigné',
    'Étage',
    'Superficie (m²)',
    'Tantièmes (/1000)',
    'Cotisation Mensuelle (MAD)',
    'Email',
    'Téléphone',
    'Accès Portail Actif',
  ];

  const rows = building.residents.map((res) => {
    const apt = aptByResidentId.get(res.id);
    return [
      building.name,
      building.city,
      res.name,
      res.cin || 'Non renseigné',
      res.isOwner ? 'Copropriétaire' : 'Locataire',
      apt ? `Lot ${apt.number}` : 'Non assigné',
      apt ? String(apt.floor) : '-',
      apt ? String(apt.area) : '-',
      apt ? String(apt.tantiemes || 100) : '-',
      apt ? String(apt.monthlyFees || building.monthlySyndicFees || 0) : '-',
      res.email,
      res.phone,
      res.hasAccount ? 'Oui' : 'Non',
    ].map(escapeCSVCell).join(';');
  });

  const csvContent = [headers.map(escapeCSVCell).join(';'), ...rows].join('\r\n');
  const dateStr = new Date().toISOString().split('T')[0];
  const safeName = building.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadCSVFile(csvContent, `Registre_Residents_${safeName}_${dateStr}.csv`);
};

// 7. EXPORT RESIDENT LIST AS OFFICIAL PDF REPORT
export const exportResidentsPDF = (building: Building, syndic?: Syndic) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;

  const aptByResidentId = new Map<string, Apartment>();
  building.apartments.forEach((apt) => {
    if (apt.ownerId) aptByResidentId.set(apt.ownerId, apt);
    if (apt.tenantId) aptByResidentId.set(apt.tenantId, apt);
  });
  building.residents.forEach((res) => {
    if (res.apartmentId && !aptByResidentId.has(res.id)) {
      const found = building.apartments.find((a) => a.id === res.apartmentId);
      if (found) aptByResidentId.set(res.id, found);
    }
  });

  const totalResidents = building.residents.length;
  const ownersCount = building.residents.filter((r) => r.isOwner).length;
  const tenantsCount = totalResidents - ownersCount;
  const assignedCount = building.residents.filter((r) => aptByResidentId.has(r.id)).length;
  const issueDate = new Date().toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const drawHeader = (pageNumber: number) => {
    doc.setFillColor(15, 118, 110); // Teal 700
    doc.rect(0, 0, pageWidth, 28, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('REGISTRE OFFICIEL DES COPROPRIÉTAIRES ET RÉSIDENTS (LOI 18-00)', 14, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Copropriété : ${building.name} — ${building.address}, ${building.city}`,
      14,
      19
    );
    doc.text(
      `Syndic : ${syndic?.name || building.managerName || 'Syndicat des Copropriétaires'}`,
      14,
      24
    );

    doc.setFont('helvetica', 'bold');
    doc.text(`Édité le : ${issueDate}`, pageWidth - 14, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(`Page ${pageNumber}`, pageWidth - 14, 21, { align: 'right' });
  };

  drawHeader(1);

  // Summary KPI Strip
  let y = 34;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, pageWidth - 28, 14, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Total Résidents : ${totalResidents}`, 20, y + 8.5);
  doc.text(`Copropriétaires : ${ownersCount}`, 80, y + 8.5);
  doc.text(`Locataires : ${tenantsCount}`, 140, y + 8.5);
  doc.text(`Lots rattachés : ${assignedCount} / ${totalResidents}`, 195, y + 8.5);

  // Table Header
  y += 20;
  const drawTableHeader = (topY: number) => {
    doc.setFillColor(30, 41, 59); // Slate 800
    doc.rect(14, topY, pageWidth - 28, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('N°', 17, topY + 6);
    doc.text('NOM COMPLET', 28, topY + 6);
    doc.text('CIN', 86, topY + 6);
    doc.text('STATUT', 112, topY + 6);
    doc.text('LOT / ÉTAGE', 142, topY + 6);
    doc.text('TANTIÈMES', 176, topY + 6);
    doc.text('TÉLÉPHONE', 204, topY + 6);
    doc.text('EMAIL', 238, topY + 6);
    return topY + 9;
  };

  y = drawTableHeader(y);
  let pageNum = 1;

  building.residents.forEach((res, idx) => {
    if (y > pageHeight - 24) {
      doc.addPage();
      pageNum++;
      drawHeader(pageNum);
      y = drawTableHeader(34);
    }

    const apt = aptByResidentId.get(res.id);
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y, pageWidth - 28, 8, 'F');
    }

    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 8, pageWidth - 14, y + 8);

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(String(idx + 1), 17, y + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.text(res.name.slice(0, 30), 28, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.text(res.cin || '-', 86, y + 5.5);

    doc.setTextColor(res.isOwner ? 15 : 3, res.isOwner ? 118 : 105, res.isOwner ? 110 : 161);
    doc.setFont('helvetica', 'bold');
    doc.text(res.isOwner ? 'Copropriétaire' : 'Locataire', 112, y + 5.5);

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text(apt ? `Lot ${apt.number} (Ét. ${apt.floor})` : 'Non assigné', 142, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.text(apt ? `${apt.tantiemes || 100} / 1000` : '-', 176, y + 5.5);
    doc.text(res.phone || '-', 204, y + 5.5);
    doc.text((res.email || '-').slice(0, 28), 238, y + 5.5);

    y += 8;
  });

  // Footer
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Document officiel généré pour le reporting syndic — ${building.name} (${building.city}) — Loi n° 18-00 & 106-12`,
    pageWidth / 2,
    pageHeight - 8,
    { align: 'center' }
  );

  const dateStr = new Date().toISOString().split('T')[0];
  const safeName = building.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Registre_Residents_${safeName}_${dateStr}.pdf`);
};

// 8. EXPORT APARTMENT INVENTORY AS CSV
export const exportApartmentsCSV = (building: Building, residents?: Resident[]) => {
  const allResidents = residents || building.residents || [];
  const residentMap = new Map<string, Resident>(allResidents.map((r) => [r.id, r]));

  const headers = [
    'Immeuble',
    'Ville',
    'N° Lot',
    'Type de Bien',
    'Étage',
    'Superficie (m²)',
    'Quote-part Tantièmes (/1000)',
    'Cotisation Mensuelle (MAD)',
    'Statut Occupation',
    'Copropriétaire',
    'Téléphone Copropriétaire',
    'CIN Copropriétaire',
    'Locataire',
    'Téléphone Locataire',
  ];

  const rows = building.apartments.map((apt) => {
    const owner = apt.ownerId ? residentMap.get(apt.ownerId) : undefined;
    const tenant = apt.tenantId ? residentMap.get(apt.tenantId) : undefined;
    const isOccupied = Boolean(owner || tenant);

    return [
      building.name,
      building.city,
      apt.number,
      COPRO_TYPE_LABELS[apt.coproType || 'apartment'] || 'Appartement',
      String(apt.floor),
      String(apt.area),
      String(apt.tantiemes || 100),
      String(apt.monthlyFees || building.monthlySyndicFees || 0),
      isOccupied ? 'Assigné / Occupé' : 'Vacant / Non assigné',
      owner ? owner.name : 'Non assigné',
      owner ? owner.phone : '-',
      owner?.cin || '-',
      tenant ? tenant.name : '-',
      tenant ? tenant.phone : '-',
    ].map(escapeCSVCell).join(';');
  });

  // Add a summary footer row
  const totalArea = building.apartments.reduce((s, a) => s + (a.area || 0), 0);
  const totalTantiemes = building.apartments.reduce((s, a) => s + (a.tantiemes || 0), 0);
  const totalMonthlyFees = building.apartments.reduce(
    (s, a) => s + (a.monthlyFees || building.monthlySyndicFees || 0),
    0
  );

  const summaryRow = [
    'TOTAL IMMEUBLE',
    building.city,
    `${building.apartments.length} lots`,
    '-',
    '-',
    `${totalArea} m²`,
    `${totalTantiemes} / 1000`,
    `${totalMonthlyFees} MAD`,
    '-',
    '-',
    '-',
    '-',
    '-',
    '-',
  ].map(escapeCSVCell).join(';');

  const csvContent = [headers.map(escapeCSVCell).join(';'), ...rows, summaryRow].join('\r\n');
  const dateStr = new Date().toISOString().split('T')[0];
  const safeName = building.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadCSVFile(csvContent, `Inventaire_Lots_Tantiemes_${safeName}_${dateStr}.csv`);
};

// 9. EXPORT APARTMENT INVENTORY AS OFFICIAL PDF REPORT
export const exportApartmentsPDF = (
  building: Building,
  residents?: Resident[],
  syndic?: Syndic
) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;

  const allResidents = residents || building.residents || [];
  const residentMap = new Map<string, Resident>(allResidents.map((r) => [r.id, r]));

  const totalLots = building.apartments.length;
  const occupiedLots = building.apartments.filter((a) => a.ownerId || a.tenantId).length;
  const totalArea = building.apartments.reduce((sum, a) => sum + (a.area || 0), 0);
  const totalTantiemes = building.apartments.reduce((sum, a) => sum + (a.tantiemes || 0), 0);
  const totalMonthlyFees = building.apartments.reduce(
    (sum, a) => sum + (a.monthlyFees || building.monthlySyndicFees || 0),
    0
  );

  const issueDate = new Date().toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const drawHeader = (pageNumber: number) => {
    doc.setFillColor(15, 118, 110); // Teal 700
    doc.rect(0, 0, pageWidth, 28, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(
      'ÉTAT DESCRIPTIF DE DIVISION & INVENTAIRE DES LOTS DE COPROPRIÉTÉ (LOI 18-00)',
      14,
      12
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Copropriété : ${building.name} — ${building.address}, ${building.city}`,
      14,
      19
    );
    doc.text(
      `Syndic : ${syndic?.name || building.managerName || 'Syndicat des Copropriétaires'}`,
      14,
      24
    );

    doc.setFont('helvetica', 'bold');
    doc.text(`Édité le : ${issueDate}`, pageWidth - 14, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(`Page ${pageNumber}`, pageWidth - 14, 21, { align: 'right' });
  };

  drawHeader(1);

  // Summary KPI Strip
  let y = 34;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, pageWidth - 28, 14, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Total Lots : ${totalLots} (${occupiedLots} occupés)`, 18, y + 8.5);
  doc.text(`Superficie Totale : ${totalArea} m²`, 82, y + 8.5);
  doc.text(`Total Tantièmes : ${totalTantiemes} / 1000`, 145, y + 8.5);
  doc.text(
    `Budget Mensuel Global : ${currencyFormatter.format(totalMonthlyFees)}`,
    210,
    y + 8.5
  );

  // Table Header
  y += 20;
  const drawTableHeader = (topY: number) => {
    doc.setFillColor(30, 41, 59); // Slate 800
    doc.rect(14, topY, pageWidth - 28, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('N° LOT', 17, topY + 6);
    doc.text('TYPE DE BIEN', 42, topY + 6);
    doc.text('ÉTAGE', 80, topY + 6);
    doc.text('SURFACE', 100, topY + 6);
    doc.text('TANTIÈMES', 125, topY + 6);
    doc.text('COTISATION', 154, topY + 6);
    doc.text('COPROPRIÉTAIRE', 188, topY + 6);
    doc.text('LOCATAIRE', 240, topY + 6);
    return topY + 9;
  };

  y = drawTableHeader(y);
  let pageNum = 1;

  building.apartments.forEach((apt, idx) => {
    if (y > pageHeight - 28) {
      doc.addPage();
      pageNum++;
      drawHeader(pageNum);
      y = drawTableHeader(34);
    }

    const owner = apt.ownerId ? residentMap.get(apt.ownerId) : undefined;
    const tenant = apt.tenantId ? residentMap.get(apt.tenantId) : undefined;

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y, pageWidth - 28, 8, 'F');
    }

    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 8, pageWidth - 14, y + 8);

    doc.setTextColor(15, 118, 110);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(`Lot ${apt.number}`, 17, y + 5.5);

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(COPRO_TYPE_LABELS[apt.coproType || 'apartment'] || 'Appartement', 42, y + 5.5);
    doc.text(apt.floor === 0 ? 'RDC' : `Étage ${apt.floor}`, 80, y + 5.5);
    doc.text(`${apt.area} m²`, 100, y + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.text(`${apt.tantiemes || 100} / 1000`, 125, y + 5.5);
    doc.text(
      currencyFormatter.format(apt.monthlyFees || building.monthlySyndicFees || 0),
      154,
      y + 5.5
    );

    doc.setFont('helvetica', owner ? 'bold' : 'normal');
    doc.setTextColor(owner ? 15 : 148, owner ? 23 : 163, owner ? 42 : 184);
    doc.text(owner ? owner.name.slice(0, 25) : 'Non assigné', 188, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(tenant ? tenant.name.slice(0, 22) : '---', 240, y + 5.5);

    y += 8;
  });

  // Totals Footer Row
  if (y > pageHeight - 24) {
    doc.addPage();
    pageNum++;
    drawHeader(pageNum);
    y = 34;
  }

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, pageWidth - 28, 9, 'F');
  doc.setDrawColor(15, 118, 110);
  doc.line(14, y, pageWidth - 14, y);
  doc.line(14, y + 9, pageWidth - 14, y + 9);

  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`TOTAL (${totalLots} LOTS)`, 17, y + 6);
  doc.text(`${totalArea} m²`, 100, y + 6);
  doc.text(`${totalTantiemes} / 1000`, 125, y + 6);
  doc.text(currencyFormatter.format(totalMonthlyFees), 154, y + 6);

  // Legal Footer
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Inventaire officiel des lots et quotes-parts d'indivision — ${building.name} (${building.city}) — Conforme Loi n° 18-00`,
    pageWidth / 2,
    pageHeight - 8,
    { align: 'center' }
  );

  const dateStr = new Date().toISOString().split('T')[0];
  const safeName = building.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Inventaire_Lots_Tantiemes_${safeName}_${dateStr}.pdf`);
};

/**
 * Generates an official printable PDF Access Sheet (Fiche d'Identifiants d'Accès)
 * for a Resident (Copropriétaire or Locataire), issued by the Syndic.
 */
export const exportResidentCredentialsPDF = (
  resident: Resident,
  building: Building,
  apartmentNumber?: string,
  syndic?: Syndic | null
) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const issueDate = new Date().toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Top Header Banner
  doc.setFillColor(15, 118, 110); // Teal 700
  doc.rect(0, 0, 210, 42, 'F');
  doc.setFillColor(245, 158, 11); // Amber 500 accent line
  doc.rect(0, 42, 210, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(
    'ROYAUME DU MAROC · SYNDICAT DES COPROPRIÉTAIRES (LOI N° 18-00 & 106-12)',
    105,
    13,
    { align: 'center' }
  );

  doc.setFontSize(17);
  doc.text("FICHE OFFICIELLE D'IDENTIFIANTS D'ACCÈS", 105, 24, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Portail Numérique Copropriétaire & Résident — Syndik Maroc', 105, 32, {
    align: 'center',
  });
  doc.setFontSize(8.5);
  doc.text(`Document confidentiel émis le ${issueDate}`, 105, 38, { align: 'center' });

  let y = 54;

  // Building & Syndic Info Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 34, 'FD');

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('1. IDENTIFICATION DE LA COPROPRIÉTÉ & DU SYNDIC GESTIONNAIRE', 18, y + 5.5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.text(`Résidence / Immeuble : ${building.name}`, 18, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Adresse : ${building.address}, ${building.city}`, 18, y + 20);
  doc.text(
    `Cabinet Syndic : ${syndic?.name || building.managerName || 'Syndic de la Copropriété'}`,
    18,
    y + 26
  );
  if (syndic?.phone || building.managerPhone) {
    doc.text(
      `Contact Syndic : ${syndic?.phone || building.managerPhone}`,
      120,
      y + 26
    );
  }

  y += 42;

  // Resident & Lot Details Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 36, 'FD');

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('2. TITULAIRE DU COMPTE & LOT RATTACHÉ', 18, y + 5.5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(`Nom & Prénom : ${resident.name}`, 18, y + 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Qualité : ${resident.isOwner ? 'Copropriétaire Titulaire' : 'Locataire Occupant'}`,
    18,
    y + 22
  );
  doc.text(`Téléphone GSM : ${resident.phone || 'Non renseigné'}`, 18, y + 29);

  doc.setFont('helvetica', 'bold');
  doc.text(
    `Lot / Appartement : ${apartmentNumber ? `Lot ${apartmentNumber}` : 'Rattaché à la résidence'}`,
    115,
    y + 15
  );
  doc.setFont('helvetica', 'normal');
  doc.text(`N° CIN : ${resident.cin || 'Non renseigné'}`, 115, y + 22);
  doc.text(`Email : ${resident.email}`, 115, y + 29);

  y += 44;

  // Credentials Block (Highlighted Dark Slate / Emerald Accent)
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.rect(14, y, 182, 48, 'F');
  doc.setDrawColor(15, 118, 110);
  doc.setLineWidth(0.6);
  doc.rect(14, y, 182, 48, 'S');
  doc.setLineWidth(0.2);

  doc.setTextColor(45, 212, 191); // Teal 400
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('3. VOS IDENTIFIANTS DE CONNEXION PERSONNELS (ESPACE RÉSIDENT)', 20, y + 9);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Adresse du Portail :', 20, y + 18);
  doc.setTextColor(255, 255, 255);
  doc.setFont('courier', 'bold');
  doc.text(`${window.location.origin}/login`, 78, y + 18);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.text('Identifiant (Email ou CIN) :', 20, y + 27);
  doc.setTextColor(253, 224, 71); // Amber 300
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(
    `${resident.email}${resident.cin ? `  (ou CIN : ${resident.cin})` : ''}`,
    78,
    y + 27
  );

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Mot de passe temporaire :', 20, y + 38);

  // Password Pill Box
  doc.setFillColor(30, 41, 59);
  doc.setDrawColor(52, 211, 153);
  doc.rect(78, y + 32, 75, 9, 'FD');
  doc.setTextColor(110, 231, 183);
  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.text(
    resident.generatedPassword || resident.invitationCode || resident.invitationToken || 'Syndik-Demo2026!',
    83,
    y + 38
  );

  y += 56;

  // Mandatory First-Login Security Notice
  doc.setFillColor(255, 251, 235); // Amber 50
  doc.setDrawColor(251, 191, 36); // Amber 400
  doc.rect(14, y, 182, 24, 'FD');

  doc.setTextColor(180, 83, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(
    'IMPORTANT — SÉCURISATION DE VOTRE COMPTE À LA PREMIÈRE CONNEXION :',
    18,
    y + 7
  );
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 53, 15);
  doc.setFontSize(8.5);
  doc.text(
    "1. Lors de votre première connexion avec ce mot de passe temporaire, la plateforme vous demandera",
    18,
    y + 13.5
  );
  doc.text(
    "   obligatoirement de choisir un nouveau mot de passe personnel et confidentiel.",
    18,
    y + 18.5
  );

  y += 32;

  // Services Available in Resident Portal
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 34, 'FD');

  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('SERVICES DISPONIBLES SUR VOTRE ESPACE COPROPRIÉTAIRE :', 18, y + 7);

  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('• Consultation de vos appels de charges et envoi de justificatifs de virement.', 18, y + 14);
  doc.text('• Téléchargement immédiat de vos Quittances Officielles de Copropriété (Loi 18-00).', 18, y + 20);
  doc.text('• Vote numérique pondéré par tantièmes aux Assemblées Générales (AGO / AGE).', 18, y + 26);
  doc.text('• Déclaration et suivi photo des incidents de maintenance & messagerie de l’immeuble.', 18, y + 31);

  // Footer
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Fiche d'accès individuelle générée par le Syndic — ${building.name} (${building.city}) — Syndik Maroc`,
    105,
    286,
    { align: 'center' }
  );

  const safeName = resident.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Fiche_Acces_Resident_${safeName}.pdf`);
};

/**
 * Generates an official printable PDF Access Sheet (Fiche d'Identifiants d'Accès Prestataire)
 * for a Service Provider (Prestataire Agréé), issued by the Syndic.
 */
export const exportPrestataireCredentialsPDF = (
  prestataire: Prestataire,
  building: Building,
  syndic?: Syndic | null
) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const issueDate = new Date().toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Top Header Banner
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.rect(0, 0, 210, 42, 'F');
  doc.setFillColor(245, 158, 11); // Amber 500
  doc.rect(0, 42, 210, 2.5, 'F');

  doc.setTextColor(253, 224, 71);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(
    'ROYAUME DU MAROC · GESTION TECHNIQUE DE COPROPRIÉTÉ (LOI N° 18-00)',
    105,
    13,
    { align: 'center' }
  );

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16.5);
  doc.text("FICHE D'ACCÈS — PORTAIL PRESTATAIRE AGRÉÉ", 105, 24, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Espace Partenaire Technique & Suivi des Bons d’Intervention', 105, 32, {
    align: 'center',
  });
  doc.setFontSize(8.5);
  doc.text(`Accréditation délivrée le ${issueDate}`, 105, 38, { align: 'center' });

  let y = 54;

  // Box 1: Syndic & Copropriété
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 32, 'FD');

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('1. CABINET SYNDIC DONNEUR D’ORDRE & RÉSIDENCE RATTACHÉE', 18, y + 5.5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.text(`Résidence / Immeuble : ${building.name} (${building.city})`, 18, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Adresse du site : ${building.address}, ${building.city}`, 18, y + 20);
  doc.text(
    `Syndic Gestionnaire : ${syndic?.name || building.managerName || 'Bureau du Syndic'}`,
    18,
    y + 26
  );

  y += 40;

  // Box 2: Prestataire Details
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 36, 'FD');

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('2. IDENTIFICATION DE L’ENTREPRISE / ARTISAN AGRÉÉ', 18, y + 5.5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(`Raison Sociale : ${prestataire.name}`, 18, y + 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Responsable Technique : ${prestataire.contactPerson || 'Non spécifié'}`, 18, y + 22);
  doc.text(`Téléphone / Astreinte : ${prestataire.phone}`, 18, y + 29);

  doc.setFont('helvetica', 'bold');
  doc.text(`Spécialité : ${prestataire.category.toUpperCase()}`, 115, y + 15);
  doc.setFont('helvetica', 'normal');
  doc.text(`N° ICE : ${prestataire.ice || 'Enregistré'}`, 115, y + 22);
  doc.text(`N° RC : ${prestataire.rc || 'Enregistré'}`, 115, y + 29);

  y += 44;

  // Box 3: Credentials Block
  doc.setFillColor(15, 23, 42);
  doc.rect(14, y, 182, 48, 'F');
  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(0.6);
  doc.rect(14, y, 182, 48, 'S');
  doc.setLineWidth(0.2);

  doc.setTextColor(253, 224, 71);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('3. VOS IDENTIFIANTS DE CONNEXION AU PORTAIL PRESTATAIRE (/provider)', 20, y + 9);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('URL de connexion :', 20, y + 18);
  doc.setTextColor(255, 255, 255);
  doc.setFont('courier', 'bold');
  doc.text(`${window.location.origin}/login`, 78, y + 18);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.text('Email Professionnel (Login) :', 20, y + 27);
  doc.setTextColor(253, 224, 71);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(prestataire.email || 'contact@prestataire.ma', 78, y + 27);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Mot de passe temporaire :', 20, y + 38);

  doc.setFillColor(30, 41, 59);
  doc.setDrawColor(251, 191, 36);
  doc.rect(78, y + 32, 75, 9, 'FD');
  doc.setTextColor(110, 231, 183);
  doc.setFont('courier', 'bold');
  doc.setFontSize(12);
  doc.text(
    prestataire.generatedPassword ||
      prestataire.invitationToken ||
      prestataire.invitationCode ||
      '—',
    83,
    y + 38
  );

  y += 56;

  // Security & Usage Notice
  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(251, 191, 36);
  doc.rect(14, y, 182, 26, 'FD');

  doc.setTextColor(180, 83, 9);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('INSTRUCTIONS DE PREMIÈRE CONNEXION & SUIVI DES INTERVENTIONS :', 18, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 53, 15);
  doc.setFontSize(8.5);
  doc.text(
    "• À votre première connexion, il vous sera demandé de définir votre propre mot de passe sécurisé.",
    18,
    y + 13.5
  );
  doc.text(
    "• Depuis votre portail (/provider), consultez vos ordres de travail, mettez à jour l'avancement",
    18,
    y + 18.5
  );
  doc.text(
    "  technique et transmettez vos comptes-rendus d'intervention directement au Syndic.",
    18,
    y + 23.5
  );

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Accréditation Prestataire émise par le Syndic — ${building.name} — Syndik Maroc`,
    105,
    286,
    { align: 'center' }
  );

  const safeName = prestataire.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Fiche_Acces_Prestataire_${safeName}.pdf`);
};

/**
 * Generates an executive PDF Summary Report for the Building Dashboard:
 * 1. Current Financial Status (Working Fund, Reserve Fund, Collection Rate, Charges & Quittances)
 * 2. Occupancy & Tantièmes Summary (Lots, Occupied vs Vacant, Owners vs Tenants, Total Shares)
 * 3. Pending & Active Maintenance Requests
 */
export const exportBuildingSummaryReportPDF = (
  building: Building,
  syndic?: Syndic | null,
  summaryData?: {
    workingBalance: number;
    reserveBalance: number;
    collectionRate: number;
    totalChargesAmount: number;
    paidChargesAmount: number;
    overdueChargesCount: number;
    pendingProofsCount: number;
    quittancesCount: number;
    charges?: Charge[];
    maintenanceRequests?: MaintenanceRequest[];
  }
) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const issueDate = new Date().toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const apartments = building.apartments || [];
  const residents = building.residents || [];
  const occupiedApartments = apartments.filter(
    (apt) =>
      Boolean(apt.ownerId || apt.tenantId) ||
      residents.some((r) => r.apartmentId === apt.id)
  );
  const vacantApartmentsCount = Math.max(0, apartments.length - occupiedApartments.length);
  const occupancyRate =
    apartments.length > 0 ? Math.round((occupiedApartments.length / apartments.length) * 100) : 0;
  const ownersCount = residents.filter((r) => r.isOwner).length;
  const tenantsCount = residents.filter((r) => !r.isOwner).length;
  const totalTantiemes =
    apartments.reduce((sum, a) => sum + (Number(a.tantiemes) || 0), 0) ||
    building.totalTantiemes ||
    1000;

  const openMaintenance = (summaryData?.maintenanceRequests || []).filter(
    (m) => m.status !== 'completed'
  );

  // Header Banner
  doc.setFillColor(15, 118, 110); // Teal 700
  doc.rect(0, 0, 210, 38, 'F');
  doc.setFillColor(15, 23, 42); // Slate 900 accent bar
  doc.rect(0, 38, 210, 2.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('ROYAUME DU MAROC · SYNDICAT DES COPROPRIÉTAIRES (LOI 18-00 & 106-12)', 14, 12);

  doc.setFontSize(16);
  doc.text('RAPPORT DE SYNTHÈSE DE LA COPROPRIÉTÉ', 14, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(
    `Résidence : ${building.name} — ${building.address}, ${building.city || 'Maroc'}`,
    14,
    30
  );
  doc.setFontSize(8.5);
  doc.text(
    `Édité le ${issueDate} · Gestionnaire : ${syndic?.name || building.managerName || 'Cabinet Syndic'}`,
    14,
    35.5
  );

  let y = 48;

  // SECTION 1: FINANCIAL STATUS
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('1. SITUATION FINANCIÈRE & TRÉSORERIE (MAD)', 18, y + 5.5);

  y += 11;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 38, 'FD');

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Fonds de Roulement (Courant) :', 18, y + 8);
  doc.setTextColor(15, 118, 110);
  doc.text(currencyFormatter.format(summaryData?.workingBalance ?? 0), 75, y + 8);

  doc.setTextColor(30, 41, 59);
  doc.text('Fonds de Réserve (Loi 106-12) :', 18, y + 16);
  doc.setTextColor(67, 56, 202);
  doc.text(currencyFormatter.format(summaryData?.reserveBalance ?? 0), 75, y + 16);

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Total Appels de Fonds : ${currencyFormatter.format(summaryData?.totalChargesAmount ?? 0)}`,
    18,
    y + 24
  );
  doc.text(
    `Montant Encaissé : ${currencyFormatter.format(summaryData?.paidChargesAmount ?? 0)}`,
    18,
    y + 31
  );

  doc.setFont('helvetica', 'bold');
  doc.text(`Taux de Recouvrement : ${summaryData?.collectionRate ?? 0}%`, 115, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Appels en retard (Impayés) : ${summaryData?.overdueChargesCount ?? 0}`, 115, y + 16);
  doc.text(`Justificatifs en attente : ${summaryData?.pendingProofsCount ?? 0}`, 115, y + 24);
  doc.text(`Quittances officielles émises : ${summaryData?.quittancesCount ?? 0}`, 115, y + 31);

  y += 45;

  // SECTION 2: OCCUPANCY & LOTS SUMMARY
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text("2. ÉTAT D'OCCUPATION & RÉPARTITION DES LOTS", 18, y + 5.5);

  y += 11;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 32, 'FD');

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`Nombre total de lots : ${apartments.length}`, 18, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Lots occupés : ${occupiedApartments.length}  |  Lots vacants : ${vacantApartmentsCount}`,
    18,
    y + 16
  );
  doc.text(`Quote-part totale : ${totalTantiemes} / 1000 tantièmes`, 18, y + 24);

  doc.setFont('helvetica', 'bold');
  doc.text(`Taux d'Occupation : ${occupancyRate}%`, 115, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Copropriétaires inscrits : ${ownersCount}`, 115, y + 16);
  doc.text(`Locataires déclarés : ${tenantsCount}`, 115, y + 24);

  y += 40;

  // SECTION 3: PENDING & IN-PROGRESS MAINTENANCE REQUESTS
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(15, 118, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `3. TRAVAUX & DEMANDES D'INTERVENTION EN ATTENTE (${openMaintenance.length})`,
    18,
    y + 5.5
  );

  y += 11;

  if (openMaintenance.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.rect(14, y, 182, 16, 'FD');
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(
      'Aucune demande de travaux ou de maintenance en attente pour cet immeuble.',
      18,
      y + 10
    );
    y += 22;
  } else {
    // Table Header
    doc.setFillColor(15, 23, 42);
    doc.rect(14, y, 182, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Date', 17, y + 5.5);
    doc.text('Catégorie', 40, y + 5.5);
    doc.text('Priorité', 72, y + 5.5);
    doc.text('Statut', 96, y + 5.5);
    doc.text('Description / Intervention', 124, y + 5.5);
    y += 8;

    openMaintenance.slice(0, 10).forEach((req, idx) => {
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
      doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(14, y, 182, 9, 'FD');

      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const reqDate = req.createdAt
        ? new Date(req.createdAt).toLocaleDateString('fr-MA')
        : issueDate;
      const statusLabel = req.status === 'in_progress' ? 'En cours' : 'En attente';
      const priorityLabel =
        req.priority === 'high' ? 'Urgente' : req.priority === 'medium' ? 'Moyenne' : 'Basse';
      const descShort =
        (req.description || '').length > 38
          ? `${req.description.substring(0, 38)}...`
          : req.description || '-';

      doc.text(reqDate, 17, y + 6);
      doc.text(String(req.category || 'Général').toUpperCase(), 40, y + 6);
      doc.text(priorityLabel, 72, y + 6);
      doc.text(statusLabel, 96, y + 6);
      doc.text(descShort, 124, y + 6);
      y += 9;
    });
  }

  // Footer
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Rapport de Synthèse Copropriété généré via Syndik Maroc — ${building.name} (${issueDate})`,
    105,
    287,
    { align: 'center' }
  );

  const safeBld = building.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Rapport_Synthese_${safeBld}.pdf`);
};

/**
 * Generates an official PDF representation for an archived copropriété document
 * so it can be previewed in-browser via a Blob URL or downloaded.
 */
function buildArchiveDocumentJsPDF(docItem: BuildingDocument, building: Building): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const uploadDate = new Date(docItem.uploadedAt || new Date()).toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 210, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('ARCHIVES LÉGALES DE LA COPROPRIÉTÉ · LOI N° 18-00 & 106-12', 14, 13);

  doc.setFontSize(14);
  doc.text(docItem.name, 14, 23);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Résidence : ${building.name} (${building.address}, ${building.city || 'Maroc'})`, 14, 31);

  let y = 48;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, y, 182, 34, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('MÉTADONNÉES DU DOCUMENT ARCHIVÉ', 18, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Nom du fichier : ${docItem.name}`, 18, y + 17);
  doc.text(`Taille : ${docItem.size || '0.4 MB'} · Date de dépôt : ${uploadDate}`, 18, y + 24);
  doc.text(`Référence Archive : ${docItem.id}`, 18, y + 30);

  y += 44;
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('EXTRAIT CERTIFIÉ DU DOCUMENT DE COPROPRIÉTÉ', 14, y);

  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(
    `Ce document officiel (« ${docItem.name} ») fait partie intégrante du registre d'archives numériques de la copropriété ${building.name}, sise à ${building.address}, ${building.city || 'Maroc'}, conformément aux dispositions de la Loi n° 18-00 relative au statut de la copropriété des immeubles bâtis telle que modifiée et complétée par la Loi n° 106-12.\n\nIl est mis à la disposition des copropriétaires et du syndic pour consultation directe en ligne et conservation légale.`,
    180
  );
  doc.text(lines, 14, y);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Archive Numérique Certifiée — ${building.name} — Consultation Directe Syndik`,
    105,
    285,
    { align: 'center' }
  );

  return doc;
}

export const generateArchiveDocumentPDFBlobUrl = (
  docItem: BuildingDocument,
  building: Building
): string => {
  const doc = buildArchiveDocumentJsPDF(docItem, building);
  return String(doc.output('bloburl'));
};

export const downloadArchiveDocumentPDF = (
  docItem: BuildingDocument,
  building: Building
): void => {
  const doc = buildArchiveDocumentJsPDF(docItem, building);
  const safeName = docItem.name.endsWith('.pdf')
    ? docItem.name
    : `${docItem.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  doc.save(safeName);
};

// Phase 2.2: Arabic-safe Latin transliteration fallback for jsPDF standard Helvetica font
const ARABIC_TRANSLIT_MAP: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'aa', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w',
  ي: 'y', ى: 'a', ة: 'a', ء: '', ئ: 'i', ؤ: 'u',
};

export function sanitizePdfText(input?: string | null): string {
  if (!input) return '';
  if (!/[\u0600-\u06FF]/.test(input)) return input;
  return Array.from(input)
    .map((ch) => (ch in ARABIC_TRANSLIT_MAP ? ARABIC_TRANSLIT_MAP[ch] : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phase 4.2: État de Répartition Annuel & Clôture d'Exercice (Loi 18-00 Art. 24 & 37 / Loi 106-12)
 */
export const exportAnnualRepartitionPDF = (
  building: Building,
  syndic?: Syndic,
  charges: Charge[] = [],
  quittances: Quittance[] = [],
  fiscalYear: number = new Date().getFullYear()
) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 210, 38, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('ROYAUME DU MAROC · SYNDICAT DES COPROPRIÉTAIRES (LOI 18-00 & 106-12)', 105, 13, {
    align: 'center',
  });
  doc.setFontSize(14);
  doc.text(
    `ÉTAT DE RÉPARTITION ANNUEL & CLÔTURE D'EXERCICE ${fiscalYear}`,
    105,
    23,
    { align: 'center' }
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Copropriété : ${sanitizePdfText(building.name)} · ${sanitizePdfText(building.address)}, ${sanitizePdfText(building.city)}`,
    105,
    31,
    { align: 'center' }
  );

  let y = 46;
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `Syndic Gestionnaire : ${sanitizePdfText(syndic?.name || 'Cabinet Syndic')}   |   Réserve : allocations historiques documentées`,
    14,
    y
  );

  y += 8;
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setFontSize(8.5);
  doc.text('Lot', 17, y + 5.5);
  doc.text('Copropriétaire', 35, y + 5.5);
  doc.text('Tantièmes', 92, y + 5.5);
  doc.text('Appelé (MAD)', 116, y + 5.5);
  doc.text('Réglé (MAD)', 144, y + 5.5);
  doc.text('Dont Réserve', 168, y + 5.5);

  y += 12;
  doc.setFont('helvetica', 'normal');
  let sumCalled = 0;
  let sumPaid = 0;
  let sumReserve = 0;
  let reserveDocumented = true;

  for (const apt of building.apartments) {
    if (y > 265) {
      doc.addPage();
      y = 20;
    }
    const owner = building.residents.find(
      (r) => r.id === apt.ownerId || r.apartmentId === apt.id
    );
    const aptCharges = charges.filter((c) => c.apartmentId === apt.id);
    const called = aptCharges.reduce((s, c) => s + (c.amount || 0), 0);
    const paid = aptCharges.reduce(
      (s, c) => s + (c.paidAmount ?? (c.status === 'paid' ? c.amount : 0)),
      0
    );
    const reserveContrib = getRecordedReserveTotal(quittances.filter(receipt =>
      receipt.buildingId === building.id && (receipt.apartmentId ? receipt.apartmentId === apt.id : receipt.apartmentNumber === apt.number)), paid);

    sumCalled += called;
    sumPaid += paid;
    if (reserveContrib === undefined) reserveDocumented = false;
    else sumReserve = Math.round((sumReserve + reserveContrib) * 100) / 100;

    doc.text(String(apt.number), 17, y);
    doc.text(sanitizePdfText(owner?.name || 'Non assigné').slice(0, 26), 35, y);
    doc.text(`${apt.tantiemes || 100}/1000`, 92, y);
    doc.text(called.toFixed(2), 116, y);
    doc.text(paid.toFixed(2), 144, y);
    doc.text(reserveContrib === undefined ? 'Non documenté' : reserveContrib.toFixed(2), 168, y);

    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 2, 196, y + 2);
    y += 7;
  }

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(240, 253, 250);
  doc.rect(14, y - 4, 182, 9, 'F');
  doc.text('TOTAL EXERCICE', 17, y + 1.5);
  doc.text(`${sumCalled.toFixed(2)} MAD`, 116, y + 1.5);
  doc.text(`${sumPaid.toFixed(2)} MAD`, 144, y + 1.5);
  doc.text(reserveDocumented ? `${sumReserve.toFixed(2)} MAD` : 'Non documenté', 168, y + 1.5);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Arrêté des comptes certifié conforme aux articles 24 et 37 de la Loi 18-00 — Quittances émises : ${quittances.length}`,
    105,
    284,
    { align: 'center' }
  );

  doc.save(`Etat_Repartition_Annuel_${building.name.replace(/\s+/g, '_')}_${fiscalYear}.pdf`);
};

/**
 * Phase 5.2: Mise en Demeure Officielle de Payer (Article 25 de la Loi n° 18-00 modifiée par la Loi 106-12)
 */
export const exportMiseEnDemeurePDF = (
  building: Building,
  syndic: Syndic | undefined,
  resident: Resident,
  apartment: Apartment | undefined,
  unpaidCharges: Charge[]
) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const totalDue = unpaidCharges.reduce(
    (s, c) => s + Math.max(0, c.amount - (c.paidAmount || 0)),
    0
  );
  const issueDate = new Date().toLocaleDateString('fr-MA');

  doc.setFillColor(153, 27, 27); // Rose/Red 800
  doc.rect(0, 0, 210, 38, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('ROYAUME DU MAROC · PROCÉDURE LÉGALE DE RECOUVREMENT (LOI 18-00 ART. 25)', 105, 13, {
    align: 'center',
  });
  doc.setFontSize(15);
  doc.text('MISE EN DEMEURE DE PAYER LES CHARGES DE COPROPRIÉTÉ', 105, 23, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Lettre recommandée avec accusé de réception · Délai légal de 30 jours avant injonction de payer`,
    105,
    31,
    { align: 'center' }
  );

  let y = 50;
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Émetteur : ${sanitizePdfText(syndic?.name || 'Syndic de Copropriété')}`, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`Immeuble : ${sanitizePdfText(building.name)} (${sanitizePdfText(building.address)}, ${sanitizePdfText(building.city)})`, 14, y + 6);
  doc.text(`Date d'émission : ${issueDate}`, 14, y + 12);

  doc.setFont('helvetica', 'bold');
  doc.text(`Destinataire Débiteur : ${sanitizePdfText(resident.name)}`, 115, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`Lot N° : ${apartment?.number || 'N/A'} (${apartment?.tantiemes || 100}/1000 tantièmes)`, 115, y + 6);
  if (resident.cin) doc.text(`CIN : ${resident.cin}`, 115, y + 12);

  y += 24;
  const bodyText = doc.splitTextToSize(
    `Madame, Monsieur,\n\nMalgré nos précédents rappels amiables, nous constatons qu'à la date du ${issueDate}, votre compte copropriétaire au sein de la résidence « ${sanitizePdfText(building.name)} » présente un solde débiteur exigible de ${currencyFormatter.format(totalDue)} au titre des cotisations votées en Assemblée Générale.\n\nPar la présente, nous vous mettons formellement en demeure, conformément à l'article 25 de la Loi n° 18-00 (telle que modifiée par la Loi n° 106-12), de régulariser ce montant sous un délai de trente (30) jours à compter de la réception de cet avis.`,
    180
  );
  doc.text(bodyText, 14, y);

  y += 42;
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Période / Désignation de la charge impayée', 18, y + 5.5);
  doc.text('Échéance', 125, y + 5.5);
  doc.text('Reste dû (MAD)', 160, y + 5.5);

  y += 13;
  doc.setFont('helvetica', 'normal');
  for (const chg of unpaidCharges.slice(0, 12)) {
    const rem = Math.max(0, chg.amount - (chg.paidAmount || 0));
    doc.text(sanitizePdfText(chg.description || chg.period || 'Appel de charges').slice(0, 52), 18, y);
    doc.text(new Date(chg.dueDate).toLocaleDateString('fr-MA'), 125, y);
    doc.text(currencyFormatter.format(rem), 160, y);
    y += 7;
  }

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(153, 27, 27);
  doc.setFontSize(11);
  doc.text(`TOTAL EXIGIBLE : ${currencyFormatter.format(totalDue)}`, 125, y);

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    "À défaut de règlement dans le délai de 30 jours, le Président du Tribunal de Première Instance sera saisi d'une requête en injonction de payer (Art. 25 bis Loi 18-00).",
    105,
    283,
    { align: 'center' }
  );

  doc.save(`Mise_En_Demeure_Lot_${apartment?.number || resident.id}.pdf`);
};
