export type FormFeedbackEvent = {
  operation: string;
  error?: string;
};

const operationMessages: Record<string, [string, string]> = {
  addBuilding: ['Immeuble créé.', 'تم إنشاء العمارة.'],
  updateBuilding: ['Immeuble mis à jour.', 'تم تحديث العمارة.'],
  addApartment: ['Lot créé.', 'تم إنشاء الوحدة.'],
  addApartmentsBulk: ['Lots créés.', 'تم إنشاء الوحدات.'],
  updateApartment: ['Lot mis à jour.', 'تم تحديث الوحدة.'],
  addResident: ['Résident enregistré.', 'تم تسجيل الساكن.'],
  updateResident: ['Résident mis à jour.', 'تم تحديث بيانات الساكن.'],
  saveSyndic: ['Paramètres enregistrés.', 'تم حفظ الإعدادات.'],
  adminCreateCabinet: ['Cabinet créé.', 'تم إنشاء المكتب.'],
  recordSubscriptionPayment: ['Paiement enregistré et abonnement prolongé.', 'تم تسجيل الدفع وتمديد الاشتراك.'],
  addMaintenanceRequest: ['Signalement envoyé au syndic. Vous pouvez suivre son avancement.', 'تم إرسال البلاغ إلى السنديك. يمكنك تتبع تقدمه.'],
  updateMaintenanceRequest: ['Suivi de maintenance enregistré.', 'تم حفظ تحديث الصيانة.'],
  confirmMaintenanceCompletion: ['Réparation confirmée.', 'تم تأكيد الإصلاح.'],
  reopenMaintenance: ['Signalement réouvert.', 'تمت إعادة فتح البلاغ.'],
  addMarketplaceItem: ['Votre annonce a été publiée dans le Souk des Résidents.', 'تم نشر إعلانك في سوق الجيران.'],
  updateMarketplaceItemStatus: ["Statut de l'annonce mis à jour.", 'تم تحديث حالة الإعلان.'],
  submitPaymentProof: ['Justificatif envoyé. Le paiement reste en attente de validation par le syndic.', 'تم إرسال الإثبات. يظل الأداء في انتظار مصادقة السنديك.'],
  reviewPaymentProof: ['Décision enregistrée. Les soldes sont actualisés après validation du paiement.', 'تم تسجيل القرار. يتم تحديث الأرصدة بعد المصادقة على الأداء.'],
  addTransaction: ['Opération financière enregistrée.', 'تم تسجيل العملية المالية.'],
  generateMonthlyCharges: ['Génération des cotisations terminée. Consultez les charges de la période.', 'اكتمل إنشاء المساهمات. راجع مستحقات الفترة.'],
  generateQuittanceForCharge: ['Paiement enregistré et quittance créée.', 'تم تسجيل الأداء وإنشاء الوصل.'],
  addAnnouncement: ['Annonce publiée.', 'تم نشر الإعلان.'],
  attachDocument: ['Document enregistré.', 'تم حفظ الوثيقة.'],
  changePassword: ['Mot de passe enregistré.', 'تم حفظ كلمة المرور.'],
  recordAGVote: ['Votre vote a été enregistré.', 'تم تسجيل تصويتك.'],
  savePrestataire: ['Prestataire enregistré.', 'تم حفظ مقدم الخدمة.'],
  addPrestataireReview: ['Votre avis a été publié.', 'تم نشر تقييمك.'],
  saveAssembleeGenerale: ['Assemblée générale enregistrée.', 'تم حفظ الجمعية العامة.'],
  createAssembleeGenerale: ['Assemblée générale créée. Ouvrez le scrutin lorsque vous êtes prêt à voter.', 'تم إنشاء الجمعية العامة. افتح التصويت عندما تكون مستعداً.'],
  castResidentAGVote: ['Votre vote a été enregistré.', 'تم تسجيل تصويتك.'],
  updateAGAttendee: ['Présence enregistrée.', 'تم تسجيل الحضور.'],
  toggleAGVoting: ['État du vote mis à jour.', 'تم تحديث حالة التصويت.'],
};

export function operationSuccess(operation: string, isAr: boolean) {
  // Sending chat messages already has an immediate, visible result in the thread.
  if (['sendChatMessage', 'markChatMessagesAsRead', 'markNotificationAsRead', 'toggleChatMessageLike'].includes(operation)) return null;
  const message = operationMessages[operation];
  if (message) return message[isAr ? 1 : 0];
  if (operation.startsWith('delete')) return isAr ? 'تم الحذف بنجاح.' : 'Suppression effectuée.';
  return isAr ? 'تم تسجيل العملية بنجاح.' : 'Opération enregistrée avec succès.';
}

export function readableError(error: unknown, isAr = false): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!raw || /failed to fetch|networkerror|load failed|network request failed/i.test(raw))
    return isAr ? 'تعذر الاتصال بالخادم. تحقق من اتصالك ثم حاول مجدداً. احتفظ ببياناتك المدخلة.' : 'Connexion au serveur impossible. Vérifiez votre connexion puis réessayez. Conservez votre saisie.';
  if (/Unexpected token|Unexpected end|JSON\.parse/i.test(raw))
    return isAr ? 'استجابة الخادم غير صالحة. حاول مجدداً أو تواصل مع الدعم.' : 'Réponse du serveur invalide. Réessayez ou contactez le support.';
  try {
    const issues = JSON.parse(raw);
    if (Array.isArray(issues) && issues.every(issue => typeof issue.message === 'string')) {
      const fields: Record<string, [string, string]> = {
        name: ['Nom', 'الاسم'], number: ['Numéro du lot', 'رقم الوحدة'], email: ['Adresse email', 'البريد الإلكتروني'],
        phone: ['Téléphone', 'الهاتف'], address: ['Adresse', 'العنوان'], city: ['Ville', 'المدينة'],
        amount: ['Montant', 'المبلغ'], title: ['Titre', 'العنوان'], description: ['Description', 'الوصف'],
        floor: ['Étage', 'الطابق'], area: ['Superficie', 'المساحة'], monthlyFees: ['Frais mensuels', 'المساهمة الشهرية'],
        buildingId: ['Immeuble', 'العمارة'], residentId: ['Résident', 'الساكن'], apartmentId: ['Lot', 'الوحدة'],
        password: ['Mot de passe', 'كلمة المرور'], content: ['Contenu', 'المحتوى'], date: ['Date', 'التاريخ'],
      };
      return issues.map(issue => {
        const key = issue.path?.at(-1);
        const label = fields[key]?.[isAr ? 1 : 0] || key || (isAr ? 'الحقل' : 'Champ');
        const reason = issue.code === 'invalid_type' && issue.received === 'undefined' ? (isAr ? 'مطلوب' : 'obligatoire')
          : issue.validation === 'email' ? (isAr ? 'أدخل بريداً إلكترونياً صحيحاً' : 'adresse email invalide')
          : issue.code === 'too_small' ? (isAr ? `القيمة صغيرة جداً (الحد الأدنى: ${issue.minimum})` : `valeur trop courte ou trop petite (minimum : ${issue.minimum})`)
          : issue.code === 'too_big' ? (isAr ? `القيمة كبيرة جداً (الحد الأقصى: ${issue.maximum})` : `valeur trop longue ou trop grande (maximum : ${issue.maximum})`)
          : (isAr ? 'تحقق من القيمة المدخلة وصيغتها.' : 'vérifiez la valeur et le format saisis.');
        return `${label} : ${reason}`;
      }).join('\n');
    }
  } catch { /* Ordinary application message. */ }
  const translations: Record<string, string> = {
    'Authentification requise.': 'انتهت جلستك أو لم تسجل الدخول. أعد تسجيل الدخول ثم حاول مجدداً.',
    'Vérifiez votre adresse email.': 'تحقق من بريدك الإلكتروني قبل المتابعة.',
    'Changez votre mot de passe initial avant de continuer.': 'غيّر كلمة المرور الأولية قبل المتابعة.',
    'Abonnement expiré : consultation et export disponibles.': 'انتهى الاشتراك. تظل الاستشارة والتصدير متاحين. تواصل مع مسؤول المكتب لتجديده.',
    'Immeuble archivé.': 'تمت أرشفة العمارة. أعد تفعيلها قبل التعديل.',
    'Immeuble introuvable.': 'لم يتم العثور على العمارة. حدّث الصفحة وحدد العمارة.',
    'Cabinet non autorisé.': 'ليس لديك صلاحية لهذا المكتب. تحقق من الحساب المسجل.',
    'Immeuble non autorisé.': 'ليس لديك صلاحية لهذه العمارة.',
    'Opération réservée au syndic.': 'هذه العملية مخصصة للسنديك.',
    'Numéro de lot déjà utilisé.': 'رقم الوحدة مستخدم بالفعل. اختر رقماً آخر.',
    'Montant invalide.': 'المبلغ غير صالح. أدخل مبلغاً صحيحاً.',
    'Prix invalide.': 'السعر غير صالح. أدخل سعراً موجباً أو صفراً للتبرع.',
    'Confirmez les soldes initiaux dans les outils financiers.': 'أكد الأرصدة الافتتاحية في قسم الكشوف والتصحيحات قبل تسجيل الأداءات والمصاريف.',
    'Email indisponible. Contactez votre syndic.': 'خدمة البريد غير متاحة. تواصل مع السنديك.',
    'Veuillez patienter une minute.': 'يرجى الانتظار دقيقة قبل المحاولة مجدداً.',
  };
  if (isAr && translations[raw]) return translations[raw];
  return raw;
}

export function notifyOperation(detail: FormFeedbackEvent) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('syndik-operation-feedback', { detail }));
}
