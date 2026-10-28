import Form, { FormNotice } from '../common/Form';
import React, { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Modal from "../common/Modal";
import Button from "../common/Button";
import { useI18n } from "../../hooks/useI18n";
import { submitPaymentProof } from "../../firebase/services";
import type {
  Apartment,
  Building,
  Charge,
  PaymentMethod,
  Resident,
} from "../../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  charge?: Charge;
  building?: Building;
  resident?: Resident;
  apartment?: Apartment;
}

const receiptTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export default function ResidentPaymentModal({
  isOpen,
  onClose,
  onSubmitted,
  charge,
  building,
  resident,
  apartment,
}: Props) {
  const { tr } = useI18n();
  const formId = useId();
  const receiptInput = useRef<HTMLInputElement>(null);
  const receiptPicker = useRef<HTMLButtonElement>(null);
  const [bankName, setBankName] = useState("Attijariwafa Bank");
  const [bankTransactionDate, setBankTransactionDate] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("virement");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remaining = Math.max(
    0,
    Math.round(((charge?.amount || 0) - (charge?.paidAmount || 0)) * 100) / 100,
  );

  const submission = useMutation({
    mutationFn: async () => {
      const receiptUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(
            new Error(
              tr(
                "Impossible de lire le justificatif.",
                "تعذر قراءة إثبات الأداء.",
              ),
            ),
          );
        reader.readAsDataURL(receipt!);
      });
      return submitPaymentProof({
        chargeId: charge!.id,
        buildingId: building!.id,
        residentId: resident!.id,
        residentName: resident!.name,
        apartmentId: apartment!.id,
        apartmentNumber: apartment!.number,
        amount: Math.round(Number(amount) * 100) / 100,
        paymentMethod: method,
        bankName,
        referenceNumber: reference.trim(),
        bankTransactionDate: bankTransactionDate || undefined,
        receiptNote: note.trim(),
        receiptUrl,
      });
    },
    onSuccess: () => {
      onSubmitted();
      onClose();
    },
    onError: (failure: Error) =>
      setError(
        failure.message ||
          tr("Envoi impossible. Réessayez.", "تعذر الإرسال. حاول مجدداً."),
      ),
  });

  // Keep the draft intact when background queries refresh the charge balance.
  useEffect(() => {
    if (!isOpen) return;
    setReference("");
    setBankTransactionDate("");
    setNote("");
    setReceipt(null);
    setReceiptError(null);
    if (receiptInput.current) receiptInput.current.value = "";
    setAmount(remaining.toFixed(2));
    setError(null);
    submission.reset();
  }, [isOpen, charge?.id]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submission.isPending) return;
    setError(null);
    if (
      !charge ||
      !building ||
      !resident ||
      !apartment ||
      charge.residentId !== resident.id ||
      charge.apartmentId !== apartment.id
    )
      return setError(
        tr(
          "La charge ou le logement ne peut pas être identifié. Actualisez la page.",
          "تعذر تحديد المساهمة أو الشقة. حدّث الصفحة.",
        ),
      );
    if (!reference.trim())
      return setError(
        tr(
          "Veuillez saisir la référence du règlement.",
          "يرجى إدخال مرجع الأداء.",
        ),
      );
    const value = Number(amount);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      Math.round(value * 100) > Math.round(remaining * 100) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
    )
      return setError(
        tr(
          "Saisissez un montant positif ne dépassant pas le solde restant, avec deux décimales maximum.",
          "أدخل مبلغاً موجباً لا يتجاوز الرصيد المتبقي، بمنزلتين عشريتين كحد أقصى.",
        ),
      );
    if (!receipt) {
      const message = tr(
        "Veuillez joindre votre justificatif de paiement.",
        "يرجى إرفاق إثبات الأداء.",
      );
      setError(message);
      setReceiptError(message);
      requestAnimationFrame(() => {
        receiptPicker.current?.focus({ preventScroll: true });
        receiptPicker.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    submission.mutate();
  };

  return (
    <Modal
      isOpen={isOpen}
      busy={submission.isPending}
      onClose={() => {
        if (!submission.isPending) onClose();
      }}
      title={tr(
        "Transmettre un justificatif de paiement",
        "إرسال إثبات الأداء",
      )}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={submission.isPending}
            onClick={onClose}
          >
            {tr("Annuler", "إلغاء")}
          </Button>
          <Button type="submit" form={formId} disabled={submission.isPending}>
            {submission.isPending
              ? tr("Envoi en cours...", "جارٍ الإرسال...")
              : tr("Envoyer pour validation", "إرسال للمصادقة")}
          </Button>
        </>
      }
    >
      <Form id={formId} onSubmit={handleSubmit} noValidate>
        <fieldset disabled={submission.isPending} className="space-y-4">
          <p className="text-xs text-slate-600">
            {tr(
              "Effectuez le règlement auprès de votre banque, puis joignez le reçu. Le syndic vérifiera le paiement avant de créditer vos charges et de délivrer une quittance.",
              "أدِّ المبلغ لدى بنكك ثم أرفق الوصل. يتحقق السنديك من الأداء قبل تسجيله وإصدار وصل الإبراء.",
            )}
          </p>
          <p className="text-sm font-semibold">
            {charge?.description} — {tr("Solde restant :", "الرصيد المتبقي:")}{" "}
            {remaining.toFixed(2)} MAD
          </p>
          <FormNotice message={error} />
          <div>
            <label
              htmlFor={`${formId}-amount`}
              className="block text-xs font-semibold mb-1"
            >
              {tr("Montant du règlement (MAD)", "مبلغ الأداء (درهم)")}
            </label>
            <input
              id={`${formId}-amount`}
              type="number"
              min="0.01"
              max={remaining}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 border rounded"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-bank`}
              className="block text-xs font-semibold mb-1"
            >
              {tr("Banque émettrice", "البنك المصدر للتحويل")}
            </label>
            <select
              id={`${formId}-bank`}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full p-2 border rounded bg-white"
            >
              {[
                "Attijariwafa Bank",
                "CIH Bank",
                "Bank of Africa (BMCE)",
                "Banque Populaire (BCP)",
                "Société Générale Maroc",
                "CFG Bank",
                "Al Barid Bank",
              ].map((bank) => (
                <option key={bank}>{bank}</option>
              ))}
              <option value="Autre banque">
                {tr("Autre banque marocaine", "بنك مغربي آخر")}
              </option>
            </select>
          </div>
          <div>
            <label
              htmlFor={`${formId}-method`}
              className="block text-xs font-semibold mb-1"
            >
              {tr("Mode de règlement", "طريقة الأداء")}
            </label>
            <select
              id={`${formId}-method`}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="w-full p-2 border rounded bg-white"
            >
              <option value="virement">
                {tr("Virement bancaire", "تحويل بنكي")}
              </option>
              <option value="versement">
                {tr("Versement espèces en agence", "إيداع نقدي بالوكالة")}
              </option>
              <option value="cheque">
                {tr("Chèque bancaire", "شيك بنكي")}
              </option>
            </select>
          </div>
          <div>
            <label htmlFor={`${formId}-bank-date`}>{tr('Date réelle du virement (si connue)', 'تاريخ التحويل الفعلي (إن كان معروفاً)')}</label>
            <input id={`${formId}-bank-date`} type="date" value={bankTransactionDate}
              onChange={e => setBankTransactionDate(e.target.value)} className="w-full border rounded p-2" />
          </div>
          <div>
            <label
              htmlFor={`${formId}-reference`}
              className="block text-xs font-semibold mb-1"
            >
              {tr(
                "N° Référence / Numéro d'opération",
                "رقم المرجع / رقم العملية",
              )}
            </label>
            <input
              id={`${formId}-reference`}
              required
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ex: VIR-20261014-998"
              className="w-full p-2 border rounded font-mono"
            />
          </div>
          <div className={`rounded-lg border p-3 space-y-2 ${receiptError ? "border-rose-400 bg-rose-50" : receipt ? "border-primary-300 bg-primary-50" : "border-slate-300 bg-slate-50"}`}>
            <label
              htmlFor={`${formId}-receipt`}
              className="block text-sm font-semibold text-slate-900"
            >
              {tr("Justificatif de paiement", "إثبات الأداء")}
            </label>
            <input
              ref={receiptInput}
              key={`${isOpen}-${charge?.id}`}
              id={`${formId}-receipt`}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              required
              hidden
              aria-describedby={`${formId}-receipt-help ${formId}-receipt-status`}
              aria-invalid={receiptError ? true : undefined}
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                // Cancelling the picker must not discard a previously selected receipt.
                if (!file) return;
                setError(null);
                if (
                  file &&
                  (!receiptTypes.includes(file.type) ||
                    file.size > 5 * 1024 * 1024 ||
                    file.size === 0)
                ) {
                  setReceipt(null);
                  e.target.value = "";
                  const message = tr(
                    "Joignez un PDF, PNG, JPEG ou WebP de 5 Mo maximum.",
                    "أرفق ملف PDF أو PNG أو JPEG أو WebP بحجم لا يتجاوز 5 ميغابايت.",
                  );
                  setReceiptError(message);
                  setError(message);
                } else {
                  setReceipt(file);
                  setReceiptError(null);
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                ref={receiptPicker}
                type="button"
                disabled={submission.isPending}
                aria-describedby={`${formId}-receipt-help ${formId}-receipt-status${receiptError ? ` ${formId}-receipt-error` : ""}`}
                aria-invalid={receiptError ? true : undefined}
                className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  // Keep this synchronous so browsers retain the user's activation.
                  receiptInput.current?.click();
                }}
              >
                {receipt
                  ? tr("Changer le justificatif", "تغيير إثبات الأداء")
                  : tr("Joindre un justificatif", "إرفاق إثبات الأداء")}
              </button>
              {receipt && (
                <Button variant="secondary" disabled={submission.isPending} onClick={() => {
                  setReceipt(null);
                  setReceiptError(null);
                  setError(null);
                  if (receiptInput.current) receiptInput.current.value = "";
                }}>
                  {tr("Retirer le fichier", "إزالة الملف")}
                </Button>
              )}
            </div>
            <p id={`${formId}-receipt-status`} role="status" aria-live="polite" className="text-sm text-slate-700 break-all">
              {receipt
                ? `${tr("Prêt à envoyer :", "جاهز للإرسال:")} ${receipt.name} (${Math.max(1, Math.ceil(receipt.size / 1024))} ${tr("Ko", "ك.ب")})`
                : tr("Aucun fichier sélectionné. Cliquez sur le bouton pour choisir votre reçu.", "لم يتم اختيار ملف. اضغط على الزر لاختيار وصل الأداء.")}
            </p>
            <p id={`${formId}-receipt-help`} className="text-xs text-slate-600">
              PDF, PNG, JPEG, WebP — {tr("5 Mo maximum", "5 ميغابايت كحد أقصى")}
            </p>
            {receiptError && <p id={`${formId}-receipt-error`} className="text-sm font-medium text-rose-800">{receiptError}</p>}
          </div>
          <div>
            <label
              htmlFor={`${formId}-note`}
              className="block text-xs font-semibold mb-1"
            >
              {tr("Note pour le syndic", "ملاحظة للسنديك")}
            </label>
            <textarea
              id={`${formId}-note`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full p-2 border rounded"
            />
          </div>
        </fieldset>
      </Form>
    </Modal>
  );
}

