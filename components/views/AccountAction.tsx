import React, { useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import Form from "../common/Form";
import { useToast } from "../common/Toast";
export default function AccountAction() {
  const { tr } = useI18n(),
    params = new URLSearchParams(window.location.search),
    mode = params.get("mode"),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const complete = async () => {
    if (!params.get("token")) throw new Error(tr("Lien incomplet. Demandez un nouveau lien.", "الرابط غير مكتمل. اطلب رابطاً جديداً."));
    if (mode !== "verify" && password.length < 10) throw new Error(tr("Le mot de passe doit contenir au moins 10 caractères.", "يجب أن تتكون كلمة المرور من 10 أحرف على الأقل."));
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
      showToast(tr("Terminé. Vous pouvez vous connecter.", "تمت العملية. يمكنك تسجيل الدخول."), 'success');
    } catch (e: any) {
      setMessage(e.message);
      throw e;
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
      <Form onSubmit={complete} className="space-y-4">
      {mode !== "verify" && (
        <label className="block">
          {tr("Au moins 10 caractères", "عشرة أحرف على الأقل")}
          <input
            className="border rounded w-full p-2"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
      <button
        className="bg-teal-700 text-white rounded p-3"
        disabled={busy}
        type="submit"
      >
        {busy ? tr("En cours…", "جاري التنفيذ…") : tr("Confirmer", "تأكيد")}
      </button>
      </Form>
      <p role="status">{message}</p>
      <a className="text-teal-700 underline" href="/login">
        {tr("Connexion", "تسجيل الدخول")}
      </a>
    </main>
  );
}
