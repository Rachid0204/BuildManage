import type { UserGuideArticle } from './types';

export const PROVIDER_GUIDES: UserGuideArticle[] = [
  {
    id: 'provider-access',
    role: 'provider',
    categoryFr: 'Démarrage Prestataire',
    categoryAr: 'انطلاق مقدم الخدمة',
    contextKeys: ['interventions', 'access', 'provider'],
    estimatedMinutes: 2,
    titleFr: 'Activer son Compte Prestataire & Consulter la Résidence',
    titleAr: 'تفعيل حساب مقدم الخدمة المعتمد والاطلاع على الإقامة',
    summaryFr:
      'Connectez-vous pour la première fois à votre portail Prestataire Agréé à l’aide de la fiche d’accès remise par le Syndic et consultez vos interventions assignées.',
    summaryAr:
      'سجل دخولك لأول مرة إلى بوابة مقدم الخدمة المعتمد باستخدام بطاقة الولوج المسلمة من طرف السنديك واطلع على التدخلات المسندة إليك.',
    prerequisitesFr: [
      'Avoir reçu votre Fiche d’Accès PDF (Email professionnel + Mot de passe temporaire) de la part du Syndic.',
    ],
    prerequisitesAr: [
      'استلام بطاقة الولوج PDF (البريد المهني + كلمة المرور المؤقتة) من طرف السنديك.',
    ],
    steps: [
      {
        titleFr: 'Se connecter sur la page /login et sécuriser son mot de passe',
        titleAr: 'تسجيل الدخول وتأمين كلمة المرور الشخصية',
        bodyFr:
          'Ouvrez le portail sur /login, saisissez l’email professionnel et le mot de passe temporaire indiqués sur votre fiche. À la première connexion, choisissez immédiatement un mot de passe personnel d’au moins 10 caractères.',
        bodyAr:
          'افتح صفحة الدخول /login وأدخل البريد الإلكتروني المهني وكلمة المرور المؤقتة. عند أول دخول، سيطلب منك النظام اختيار كلمة مرور شخصية جديدة من 10 أحرف على الأقل.',
        tipFr:
          'Votre compte est strictement isolé : vous ne voyez que les tickets qui vous sont assignés ou qui relèvent de votre spécialité.',
        tipAr:
          'حسابك معزول بالكامل: لا تظهر لك سوى التدخلات المسندة إليك أو التابعة لتخصصك.',
      },
      {
        titleFr: 'Consulter la liste des bons d’intervention assignés',
        titleAr: 'الاطلاع على لائحة أوامر التدخل المسندة',
        bodyFr:
          'Depuis le tableau de bord Prestataire, repérez le nom de la résidence, le niveau d’urgence (Urgence, Haute, Moyenne, Basse), la catégorie technique et la description du problème.',
        bodyAr:
          'من لوحة مقدم الخدمة، اطلع على اسم الإقامة ومستوى الاستعجال (طوارئ، عالية، متوسطة، منخفضة) ونوع العطب ووصف المشكلة.',
        screenshot: {
          src: '/guides/screenshots/provider/portal-overview.jpg',
          altFr: 'Vue générale du portail Prestataire Agréé avec les bons d’intervention assignés',
          altAr: 'الواجهة الرئيسية لبوابة مقدم الخدمة المعتمد مع أوامر التدخل',
          captionFr:
            'Portail Prestataire : badges de priorité, résidence rattachée et liste filtrée de vos bons d’intervention.',
          captionAr:
            'بوابة مقدم الخدمة: شارات الأولوية والإقامة المرتبطة وقائمة أوامر التدخل الخاصة بك.',
        },
      },
    ],
    faq: [
      {
        qFr: 'Pourquoi je ne vois pas les documents comptables ou les AG de l’immeuble ?',
        qAr: 'لماذا لا أرى الوثائق المحاسبية أو الجمعيات العامة للإقامة؟',
        aFr: 'Par conformité et confidentialité, le portail Prestataire donne accès uniquement aux bons d’intervention techniques qui vous concernent.',
        aAr: 'حفاظاً على السرية ووفقاً لضوابط الملكية المشتركة، تقتصر صلاحيات بوابة المزود على أوامر التدخل التقنية الخاصة به فقط.',
      },
    ],
  },
  {
    id: 'provider-interventions',
    role: 'provider',
    categoryFr: 'Interventions Techniques',
    categoryAr: 'التدخلات التقنية',
    contextKeys: ['interventions', 'tickets'],
    estimatedMinutes: 3,
    titleFr: 'Prendre en Charge un Bon d’Intervention (En cours → Terminé)',
    titleAr: 'معالجة أمر التدخل وتحديث حالته (قيد الإنجاز ← مكتمل)',
    summaryFr:
      'Mettez à jour l’avancement d’une panne en temps réel pour informer le Syndic et le copropriétaire concerné.',
    summaryAr:
      'حدّث حالة إصلاح العطب في الوقت الفعلي لإخبار السنديك والساكن المعني بتقدم الأشغال.',
    steps: [
      {
        titleFr: 'Ouvrir le formulaire de mise à jour sur un ticket actif',
        titleAr: 'فتح استمارة التحديث لأمر التدخل',
        bodyFr:
          'Cliquez sur le bouton « Mettre à jour / Intervenir » sur la carte du bon d’intervention concerné. Le panneau technique s’ouvre directement dans la carte.',
        bodyAr:
          'اضغط على زر «تحديث / التدخل» في بطاقة أمر التدخل المعني لفتح لوحة التقرير التقني مباشرة.',
        screenshot: {
          src: '/guides/screenshots/provider/ticket-update.jpg',
          altFr: 'Panneau de mise à jour technique d’un bon d’intervention prestataire',
          altAr: 'لوحة التحديث التقني لأمر التدخل في بوابة المزود',
          captionFr:
            'Mise à jour directe du statut (En cours ou Intervention terminée) avec compte-rendu technique horodaté.',
          captionAr:
            'تحديث مباشر لحالة التدخل (قيد الإنجاز أو مكتمل) مع تقرير تقني مؤرخ.',
        },
      },
      {
        titleFr: 'Passer le statut à « En cours » dès le début des travaux',
        titleAr: 'تحويل الحالة إلى «قيد الإنجاز» عند بدء الأشغال',
        bodyFr:
          'Sélectionnez « En cours » pour indiquer votre prise en charge (diagnostic effectué, pièce commandée ou technicien sur place), saisissez une note claire et enregistrez.',
        bodyAr:
          'اختر «قيد الإنجاز» لتأكيد بدء المعالجة (تشخيص العطب، طلب قطعة غيار أو حضور التقني)، أضف ملاحظة واضحة واضغط على حفظ.',
        tipFr:
          'Chaque mise à jour envoie automatiquement une notification au Syndic et au résident déclarant.',
        tipAr:
          'كل تحديث يرسل إشعاراً تلقائياً للسنديك وللساكن الذي صرح بالعطب.',
      },
    ],
  },
  {
    id: 'provider-notes',
    role: 'provider',
    categoryFr: 'Clôture & Traçabilité',
    categoryAr: 'الإغلاق والتتبع',
    contextKeys: ['interventions', 'closure'],
    estimatedMinutes: 2,
    titleFr: 'Rédiger un Compte-Rendu Technique & Clôturer l’Intervention',
    titleAr: 'كتابة التقرير التقني وإغلاق التدخل',
    summaryFr:
      'Documentez les travaux réalisés et clôturez proprement le bon d’intervention pour déclencher la validation du Syndic.',
    summaryAr:
      'وثّق الأشغال المنجزة وأغلق أمر التدخل بشكل رسمي لإشعار السنديك بانتهاء الإصلاح.',
    steps: [
      {
        titleFr: 'Décrire précisément les pièces remplacées et les tests effectués',
        titleAr: 'وصف القطع المستبدلة والاختبارات المنجزة بدقة',
        bodyFr:
          'Dans le champ « Compte-rendu technique », indiquez la cause identifiée, les pièces changées, la durée et la date de remise en service. Ce journal reste archivé dans l’historique de l’immeuble.',
        bodyAr:
          'في خانة التقرير التقني، دوّن سبب العطب والقطع التي تم تغييرها ومدة التدخل وتاريخ إعادة التشغيل، حيث يُحفظ هذا السجل في أرشيف العمارة.',
      },
      {
        titleFr: 'Sélectionner « Terminé / Clôturer » et valider',
        titleAr: 'اختيار «مكتمل / إغلاق» والتأكيد',
        bodyFr:
          'Une fois la réparation vérifiée, choisissez le statut « Terminé » et validez. Le ticket est alors verrouillé contre toute modification accidentelle : seul le Syndic peut le rouvrir si nécessaire.',
        bodyAr:
          'بعد التأكد من نجاح الإصلاح، اختر حالة «مكتمل» واضغط حفظ. يتم قفل التدخل لحماية السجل ولا يمكن إعادة فتحه إلا من طرف السنديك عند الحاجة.',
      },
    ],
    faq: [
      {
        qFr: 'Que faire si je dois revenir sur un ticket déjà marqué Terminé ?',
        qAr: 'ماذا أفعل إذا احتجت للعودة إلى تدخل تم إغلاقه؟',
        aFr: 'Contactez le Syndic de la résidence : lui seul dispose du droit de réouverture d’un ticket clôturé pour garantir l’intégrité du suivi.',
        aAr: 'تواصل مع سنديك الإقامة: هو الوحيد الذي يملك صلاحية إعادة فتح تدخل مغلق لضمان مصداقية التتبع.',
      },
    ],
  },
];
