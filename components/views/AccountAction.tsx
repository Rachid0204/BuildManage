import React, { useState } from "react";
import { useI18n } from "../../hooks/useI18n";
export default function AccountAction() {
  const { tr } = useI18n(),
    params = new URLSearchParams(window.location.search),
    mode = params.get("mode"),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const complete = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/recovery/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params.get("token"), password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage(
        tr(
          "Terminé. Vous pouvez vous connecter.",
          "تمت العملية. يمكنك تسجيل الدخول.",
        ),
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="max-w-md mx-auto my-16 p-8 bg-white rounded-xl shadow space-y-5">
      <h1 className="text-xl font-bold">
        {mode === "verify"
          ? tr("Vérifier mon adresse", "تأكيد بريدي الإلكتروني")
          : tr("Nouveau mot de passe", "كلمة مرور جديدة")}
      </h1>
      {mode !== "verify" && (
        <label className="block">
          {tr("Au moins 10 caractères", "عشرة أحرف على الأقل")}
          <input
            className="border rounded w-full p-2"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
      <button
        className="bg-teal-700 text-white rounded p-3"
        disabled={busy || (mode !== "verify" && password.length < 10)}
        onClick={() => void complete()}
      >
        {busy ? tr("En cours…", "جاري التنفيذ…") : tr("Confirmer", "تأكيد")}
      </button>
      <p role="status">{message}</p>
      <a className="text-teal-700 underline" href="/login">
        {tr("Connexion", "تسجيل الدخول")}
      </a>
    </main>
  );
}
