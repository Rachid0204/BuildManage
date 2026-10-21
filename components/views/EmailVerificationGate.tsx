import React, { useState } from "react";
import { getAuthenticatedRequestHeaders } from "../../utils/security";
import { useAuth } from "../../contexts/AuthContext";
import { useI18n } from "../../hooks/useI18n";
export default function EmailVerificationGate() {
  const { logout } = useAuth(),
    { tr } = useI18n(),
    [message, setMessage] = useState("");
  const resend = async () => {
    try {
      const r = await fetch("/api/auth/verification/request", {
        method: "POST",
        headers: getAuthenticatedRequestHeaders(),
      });
      const d = await r.json();
      setMessage(
        r.ok ? tr("Le lien a été envoyé.", "تم إرسال الرابط.") : d.error,
      );
    } catch {
      setMessage(tr("Envoi impossible.", "تعذر الإرسال."));
    }
  };
  return (
    <main className="max-w-lg mx-auto my-16 p-8 rounded-xl bg-white shadow space-y-4">
      <h1 className="text-xl font-bold">
        {tr("Vérifiez votre adresse email", "أكد عنوان بريدك الإلكتروني")}
      </h1>
      <p>
        {tr(
          "Ouvrez le lien personnel reçu par email, puis actualisez cette page.",
          "افتح الرابط الشخصي المرسل إلى بريدك ثم حدّث الصفحة.",
        )}
      </p>
      <div className="flex gap-3">
        <button onClick={() => void resend()}>
          {tr("Renvoyer le lien", "إعادة إرسال الرابط")}
        </button>
        <button onClick={() => window.location.reload()}>
          {tr("Actualiser", "تحديث")}
        </button>
        <button onClick={() => void logout()}>
          {tr("Déconnexion", "خروج")}
        </button>
      </div>
      <p role="status">{message}</p>
    </main>
  );
}
