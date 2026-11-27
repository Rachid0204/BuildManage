import type { UserGuideArticle } from './types';

export const ADMIN_GUIDES: UserGuideArticle[] = [
  {
    id: 'admin-cabinets',
    role: 'admin',
    categoryFr: 'Supervision Cabinets',
    categoryAr: 'إشراف المكاتب',
    contextKeys: ['cabinets', 'admin'],
    estimatedMinutes: 4,
    titleFr: 'Gérer les Cabinets Syndics, Encaissements Guichet & Rappels',
    titleAr: 'إدارة مكاتب السنديك، التحصيل النقدي بالشباك والتنبيهات',
    summaryFr:
      'Créez et pilotez les cabinets inscrits sur la plateforme, suivez les KPIs MRR/ARR et périodes de grâce, encaissez au guichet (Espèces, Wafacash, Chèque) et envoyez des rappels d’échéance.',
    summaryAr:
      'أنشئ وأدر مكاتب السنديك المسجلة في المنصة، تابع مؤشرات MRR/ARR وفترات السماح، سجل التحصيلات النقدية أو بالشيك وأرسل تذكيرات التجديد.',
    steps: [
      {
        titleFr: 'Lire les KPIs globaux et filtrer les cabinets par statut ou forfait',
        titleAr: 'قراءة المؤشرات العامة وتصفية المكاتب حسب الحالة أو الباقة',
        bodyFr:
          'En haut de la console Super-Admin, suivez le nombre de cabinets actifs, d’immeubles gérés, le MRR mensuel, l’ARR annuel et les revenus encaissés. Utilisez la barre de recherche (nom, email, ville, ICE) et les filtres de statut (Actifs, En essai, Expirés, Suspendus, Archivés).',
        bodyAr:
          'في أعلى لوحة الإدارة العامة، راقب عدد المكاتب النشطة والعمارات والعائد الشهري MRR والسنوي ARR والمداخيل المحصلة. استخدم البحث والفلاتر لتصفية المكاتب حسب الحالة أو الباقة.',
        screenshot: {
          src: '/guides/screenshots/admin/cabinets.jpg',
          altFr: 'Onglet Cabinets de la console Super-Admin avec KPIs MRR/ARR et liste des cabinets',
          altAr: 'تبويب المكاتب في لوحة الإدارة العامة مع مؤشرات MRR/ARR',
          captionFr:
            'Vue Cabinets : KPIs nationaux (MRR, ARR, Encaissés), alertes d’échéance avec bouton Rappel 1-clic et tableau des cabinets.',
          captionAr:
            'واجهة المكاتب: المؤشرات الوطنية وتنبيهات انتهاء الاشتراك مع زر التذكير السريع.',
        },
      },
      {
        titleFr: 'Encaisser un abonnement au guichet (Espèces / Agence / Chèque) & télécharger le Reçu PDF',
        titleAr: 'تحصيل اشتراك بالشباك (نقداً / وكالة / شيك) وتحميل الوصل PDF',
        bodyFr:
          'Cliquez sur « Gérer l’abonnement » sur la ligne d’un cabinet. Dans la section « Encaisser l’abonnement », choisissez la durée (1, 3, 6 ou 12 mois), le mode (Espèces, Wafacash, Cash Plus, Barid Cash, Chèque, Virement), cliquez sur « Auto-générer » pour créer une référence unique, ajoutez un code promo éventuel puis cliquez sur « Encaisser & Prolonger ». Le bouton « Télécharger Reçu / Facture PDF » apparaît immédiatement.',
        bodyAr:
          'اضغط على «إدارة الاشتراك» بجانب المكتب. في قسم التحصيل، اختر المدة وطريقة الأداء (نقداً، وفاكاش، كاش بلوس، بريد كاش، شيك، تحويل)، اضغط «توليد تلقائي» للمرجع ثم «تحصيل وتمديد»، وسيظهر زر تحميل الوصل/الفاتورة PDF فوراً.',
        tipFr:
          'En cas d’erreur, cliquez sur « Annuler » dans l’historique du cabinet : la facture passe en Avoir (DOCUMENT ANNULE / AVOIR), l’usage du code promo est restauré et la date d’échéance précédente est rétablie.',
        tipAr:
          'في حالة الخطأ، اضغط «إلغاء» في سجل المدفوعات لاسترجاع الحالة السابقة للاشتراك وإلغاء احتساب الرمز الترويجي تلقائياً.',
        screenshot: {
          src: '/guides/screenshots/admin/manage-cabinet.jpg',
          altFr: 'Fenêtre Gérer le Cabinet avec coordonnées fiscales et bloc d’encaissement guichet',
          altAr: 'نافذة إدارة المكتب مع قسم التحصيل النقدي وتمديد الاشتراك',
          captionFr:
            'Modal Gérer le Cabinet : édition ICE/RC/IF, encaissement guichet multi-canaux, historique et téléchargement PDF.',
          captionAr:
            'نافذة إدارة المكتب: تعديل المعرفات الضريبية والتحصيل متعدد القنوات وسجل الفواتير.',
        },
      },
      {
        titleFr: 'Envoyer un rappel de renouvellement en 1 clic',
        titleAr: 'إرسال تذكير بتجديد الاشتراك بنقرة واحدة',
        bodyFr:
          'Pour les cabinets arrivant à échéance (≤ 15 jours) ou en période de grâce, utilisez le bouton « Rappel » dans l’encart d’alerte. Une notification interne est immédiatement envoyée au portail du Syndic, complétée par un email si la messagerie SMTP/SendGrid est configurée.',
        bodyAr:
          'للمكاتب القريبة من انتهاء الصلاحية (أقل من 15 يوماً) أو في فترة السماح، اضغط زر «تذكير». يصل إشعار فوري داخل بوابة السنديك بالإضافة إلى بريد إلكتروني عند تفعيل خادم البريد.',
      },
    ],
  },
  {
    id: 'admin-reports',
    role: 'admin',
    categoryFr: 'Revenus & Validation',
    categoryAr: 'المداخيل والمصادقة',
    contextKeys: ['reports'],
    estimatedMinutes: 3,
    titleFr: 'Rapports SaaS, Répartition Passerelles & File de Validation Hors-Ligne',
    titleAr: 'التقارير المالية، توزيع بوابات الدفع وطلبات المصادقة',
    summaryFr:
      'Analysez les encaissements par passerelle (CMI, PayPal, Virement, Espèces, Chèque), suivez la tendance sur 6 mois, validez les justificatifs soumis par les syndics et exportez le journal comptable CSV/PDF.',
    summaryAr:
      'حلل المداخيل حسب وسيلة الأداء وتابع المنحنى الشهري لـ 6 أشهر وصادق على وصولات التحويل والنقد وصدّر السجل المحاسبي.',
    steps: [
      {
        titleFr: 'Suivre les encaissements par passerelle et la tendance 6 mois',
        titleAr: 'متابعة التحصيلات حسب البوابة والمنحنى الزمني لـ 6 أشهر',
        bodyFr:
          'Ouvrez l’onglet « Paiements & Rapports SaaS ». Les deux panneaux analytiques détaillent le chiffre d’affaires par mode de règlement (CMI 3DS, PayPal, Virement, Espèces/Agences, Chèque) ainsi que l’évolution mensuelle sur les 6 derniers mois.',
        bodyAr:
          'افتح تبويب «المدفوعات وتقارير المنصة» للاطلاع على توزيع المداخيل حسب كل بوابة وتطور التحصيل خلال الأشهر الستة الأخيرة.',
        screenshot: {
          src: '/guides/screenshots/admin/reports.jpg',
          altFr: 'Onglet Paiements & Rapports SaaS avec répartition par passerelle, tendance 6 mois et file de validation',
          altAr: 'تبويب المدفوعات وتقارير المنصة مع توزيع البوابات وطلبات المصادقة',
          captionFr:
            'Rapports SaaS : ventilation par passerelle, courbe 6 mois, file unifiée Virement/Espèces et registre des factures PDF.',
          captionAr:
            'تقارير المنصة: التوزيع حسب بوابة الدفع، تطور 6 أشهر وسجل الفواتير الرسمية.',
        },
      },
      {
        titleFr: 'Valider ou rejeter une demande Virement / Espèces / Agence / Chèque',
        titleAr: 'المصادقة على طلبات التحويل البنكي أو الإيداع النقدي أو رفضها',
        bodyFr:
          'Filtrez la file d’attente (Tous, Virements RIB, Espèces & Chèques), cliquez sur « Voir justificatif » pour contrôler le reçu bancaire ou d’agence, puis cliquez sur « Valider & Activer » (crée automatiquement la facture numérotée et prolonge le cabinet) ou « Rejeter » avec un motif précis.',
        bodyAr:
          'صفِّ قائمة الانتظار (الكل، تحويلات، نقداً وشيكات)، اعرض الوصل المرفق للتحقق منه، ثم اضغط «مصادقة وتفعيل» لإصدار الفاتورة وتمديد الاشتراك تلقائياً أو «رفض» مع ذكر السبب.',
      },
      {
        titleFr: 'Télécharger une Facture PDF ou exporter le CSV comptable',
        titleAr: 'تحميل فاتورة PDF أو تصدير سجل CSV للمحاسبة',
        bodyFr:
          'Dans le registre des paiements, filtrez par méthode ou référence, téléchargez la Facture / Reçu PDF officielle sur chaque ligne, ou cliquez sur « Exporter CSV » pour votre cabinet comptable.',
        bodyAr:
          'في سجل المدفوعات، صفِّ حسب وسيلة الدفع أو المرجع، حمّل الفاتورة الرسمية PDF لكل عملية أو صدّر ملف CSV للمحاسب.',
      },
    ],
  },
  {
    id: 'admin-gateways',
    role: 'admin',
    categoryFr: 'Passerelles de Paiement',
    categoryAr: 'بوابات الدفع',
    contextKeys: ['billing'],
    estimatedMinutes: 5,
    titleFr: 'Configurer CMI Maroc 3DS, PayPal, Virement RIB & Agences Cash',
    titleAr: 'إعداد CMI المغرب 3DS و PayPal والتحويل البنكي ووكالات النقد',
    summaryFr:
      'Activez et sécurisez les 4 moyens de règlement proposés aux syndics : carte marocaine CMI 3D-Secure, PayPal international, virement bancaire RIB et dépôt espèces/agences (Wafacash, Cash Plus, Barid Cash, Bureau, Chèque).',
    summaryAr:
      'فعّل وأمّن وسائل الدفع الأربع المتاحة للمكاتب: البطاقة المغربية CMI، و PayPal، والتحويل البنكي RIB، والإيداع النقدي عبر الوكالات والشيك.',
    steps: [
      {
        titleFr: 'Vérifier le bandeau d’état des passerelles (Readiness Strip)',
        titleAr: 'مراجعة شريط جاهزية البوابات والتنبيهات',
        bodyFr:
          'En haut de l’onglet « Passerelles & Paiements », vérifiez l’état de chaque passerelle et les avertissements de sécurité (ex. PayPal Live sans Webhook ID ou Store Key CMI manquante).',
        bodyAr:
          'في أعلى تبويب «بوابات الدفع»، راجع حالة كل بوابة والتنبيهات الأمنية (مثل تفعيل PayPal Live بدون Webhook ID).',
        screenshot: {
          src: '/guides/screenshots/admin/gateways.jpg',
          altFr: 'Onglet Passerelles & Paiements avec CMI Maroc 3DS, PayPal, RIB et Espèces/Agences',
          altAr: 'تبويب بوابات الدفع مع إعدادات CMI و PayPal و RIB ووكالات النقد',
          captionFr:
            'Configuration centralisée : CMI Maroc (SHA-512), PayPal chiffré, validation RIB/IBAN/SWIFT/ICE et canaux Espèces/Agences.',
          captionAr:
            'إعداد مركزي لبوابات الدفع المغربية والدولية مع اختبار الاتصال والتحقق الفوري.',
        },
      },
      {
        titleFr: 'Paramétrer CMI Maroc 3D-Secure (ver3 SHA-512)',
        titleAr: 'إعداد بوابة CMI المغرب 3D-Secure',
        bodyFr:
          'Saisissez votre Client ID CMI, votre Store Key secrète (chiffrée AES-256-GCM en base et masquée après sauvegarde), choisissez l’environnement (Test / Production) et la devise (504 MAD). Copiez les URLs « Callback Server-to-Server » et « Retour Navigateur » pour les communiquer au CMI, puis lancez « Tester CMI (SHA-512) ».',
        bodyAr:
          'أدخل معرف التاجر Client ID ومفتاح التشفير Store Key (يُحفظ مشفراً بالكامل)، اختر البيئة (اختبار أو إنتاج) والعملة (504 درهم)، انسخ روابط Callback و Return لإرسالها إلى CMI ثم اضغط «اختبار CMI».',
      },
      {
        titleFr: 'Sécuriser PayPal, Virement RIB et Espèces / Agences (Wafacash, Cash Plus, Barid Cash)',
        titleAr: 'تأمين PayPal والتحويل البنكي RIB وقنوات الأداء النقدي',
        bodyFr:
          'Pour PayPal en mode Live, renseignez impérativement le Webhook ID officiel. Pour le Virement Maroc, saisissez le RIB 24 chiffres (formatage et contrôle IBAN/SWIFT/ICE en direct). Pour Espèces/Agences, cochez les canaux acceptés, renseignez le bénéficiaire, l’adresse, les horaires, le plafond espèces CGI (5 000 MAD par défaut) et l’exigence de justificatif, puis cliquez sur « Enregistrer ».',
        bodyAr:
          'بالنسبة لـ PayPal Live، أدخل معرف Webhook ID. للتحويل البنكي، أدخل رقم RIB من 24 رقماً. وللدفع النقدي، حدد القنوات المقبولة (المكتب، وفاكاش، كاش بلوس، بريد كاش، شيك) والسقف النقدي وإلزامية إرفاق الوصل ثم اضغط حفظ.',
      },
    ],
    legalNoteFr:
      'Conformité CGI Maroc : le plafond espèces par défaut (5 000 MAD) évite les règlements en numéraire au-delà du seuil légal déductible ; au-delà, le syndic est orienté vers Chèque, Virement RIB ou CMI.',
    legalNoteAr:
      'الامتثال للمدونة العامة للضرائب بالمغرب: السقف النقدي الافتراضي (5000 درهم) يوجه المبالغ الأكبر نحو الشيك أو التحويل البنكي أو CMI.',
  },
  {
    id: 'admin-commercial',
    role: 'admin',
    categoryFr: 'Facturation & Offres',
    categoryAr: 'الفوترة والعروض',
    contextKeys: ['commercial'],
    estimatedMinutes: 3,
    titleFr: 'Profil Fiscal Émetteur (ICE/TVA), Remises Multi-Mois, Grâce & Codes Promo',
    titleAr: 'الملف الضريبي (ICE/TVA)، خصومات المدة، فترة السماح والرموز الترويجية',
    summaryFr:
      'Configurez les mentions légales marocaines de vos factures PDF, les remises 3/6/12 mois, la période de grâce post-échéance (0–30 jours) et vos campagnes de codes promo.',
    summaryAr:
      'اضبط البيانات القانونية المغربية للفواتير PDF وخصومات 3/6/12 شهراً وفترة السماح بعد الانتهاء وحملات الرموز الترويجية.',
    steps: [
      {
        titleFr: 'Compléter le Profil Émetteur Maroc & le régime TVA (0% ou 20%)',
        titleAr: 'إكمال الملف الضريبي للمنصة ونظام TVA',
        bodyFr:
          'Dans l’onglet « Facturation & Offres », renseignez la raison sociale, forme juridique (SARL, SARL AU, SA, Auto-Entrepreneur), ICE (15 chiffres), RC, IF, Patente, CNSS, préfixes de numérotation (FAC / REC) et taux de TVA (0% ou 20%). Toutes les factures et reçus PDF générés reprennent immédiatement ces mentions.',
        bodyAr:
          'في تبويب «الفوترة والعروض»، أدخل الاسم التجاري والشكل القانوني و ICE (15 رقماً) و RC و IF والبتانتا وبادئات الترقيم (FAC / REC) ونسبة TVA (0% أو 20%) لتظهر على جميع فواتير PDF.',
        screenshot: {
          src: '/guides/screenshots/admin/commercial.jpg',
          altFr: 'Onglet Facturation & Offres avec profil émetteur Maroc, remises multi-mois et gestionnaire de codes promo',
          altAr: 'تبويب الفوترة والعروض مع الملف الضريبي وإدارة الرموز الترويجية',
          captionFr:
            'Profil fiscal Maroc (ICE/RC/IF/TVA), aperçu tarifaire 6m/12m, période de grâce et tableau CRUD des codes promo.',
          captionAr:
            'الملف الضريبي المغربي، معاينة الأسعار، فترة السماح وإدارة الرموز الترويجية.',
        },
      },
      {
        titleFr: 'Régler les remises multi-mois et la période de grâce post-échéance',
        titleAr: 'ضبط خصومات الاشتراك متعدد الأشهر وفترة السماح',
        bodyFr:
          'Définissez vos pourcentages de remise pour 3, 6 et 12 mois (aperçu tarifaire calculé en direct) et la période de grâce (0 à 30 jours) pendant laquelle un cabinet échu garde ses droits d’écriture avec une bannière d’alerte ambre.',
        bodyAr:
          'حدد نسب الخصم لـ 3 و 6 و 12 شهراً وفترة السماح (من 0 إلى 30 يوماً) التي يحتفظ خلالها المكتب بصلاحية الكتابة مع تنبيه مرئي لتسريع التجديد.',
      },
      {
        titleFr: 'Créer, activer ou désactiver des codes promotionnels',
        titleAr: 'إنشاء وتفعيل أو إيقاف الرموز الترويجية',
        bodyFr:
          'Créez un code (ex. BIENVENUE20 ou RAMADAN100) en pourcentage ou montant fixe MAD, limitez-le éventuellement à certains forfaits, à une durée minimale, à une date d’expiration ou à un nombre maximal d’utilisations. Les codes sont utilisables sur CMI, PayPal, Virement, Espèces et guichet.',
        bodyAr:
          'أنشئ رمزاً ترويجياً بنسبة مئوية أو مبلغ ثابت بالدرهم مع إمكانية تقييده بباقات معينة أو مدة دنيا أو تاريخ انتهاء أو عدد استعمالات أقصى.',
      },
    ],
  },
  {
    id: 'admin-audit',
    role: 'admin',
    categoryFr: 'Audit & Cadre Légal',
    categoryAr: 'التدقيق والإطار القانوني',
    contextKeys: ['audit', 'legal'],
    estimatedMinutes: 2,
    titleFr: 'Surveiller les Webhooks CMI/PayPal & le Journal d’Audit Plateforme',
    titleAr: 'مراقبة Webhooks لبوابات CMI/PayPal وسجل تدقيق المنصة',
    summaryFr:
      'Contrôlez en temps réel chaque callback CMI, webhook PayPal et action sensible réalisée sur la console d’administration.',
    summaryAr:
      'راقب في الوقت الفعلي كل إشعار وارد من CMI أو PayPal وكل عملية حساسة مسجلة في لوحة الإدارة.',
    steps: [
      {
        titleFr: 'Filtrer le Moniteur Webhooks & Callbacks Passerelles',
        titleAr: 'تصفية مراقب Webhooks وإشعارات بوابات الدفع',
        bodyFr:
          'Ouvrez l’onglet « Audit & Webhooks ». Filtrez par passerelle (CMI, PayPal, Virement, Espèces, Système) et par statut (Succès, Erreur, Rejeté) pour diagnostiquer instantanément un échec de signature, un remboursement ou un paiement capturé.',
        bodyAr:
          'افتح تبويب «التدقيق و Webhooks» وصفِّ حسب البوابة والحالة (نجاح، خطأ، مرفوض) لتشخيص أي عملية دفع أو توقيع إلكتروني فوراً.',
        screenshot: {
          src: '/guides/screenshots/admin/audit-webhooks.jpg',
          altFr: 'Onglet Audit & Webhooks affichant le moniteur passerelles et le journal d’audit immuable',
          altAr: 'تبويب التدقيق و Webhooks يعرض سجل البوابات وسجل العمليات',
          captionFr:
            'Traçabilité complète : callbacks CMI/PayPal horodatés et journal d’audit filtrable par opération ou recherche texte.',
          captionAr:
            'تتبع شامل لإشعارات CMI/PayPal وسجل تدقيق قابل للبحث والتصفية.',
        },
      },
      {
        titleFr: 'Rechercher une opération dans le Journal d’Audit Plateforme',
        titleAr: 'البحث عن عملية في سجل تدقيق المنصة',
        bodyFr:
          'Utilisez la recherche libre ou le filtre d’opération (modifications de passerelles, encaissements, annulations, promos, rappels) pour vérifier qui a exécuté quelle action et à quelle heure.',
        bodyAr:
          'استخدم البحث النصي أو فلتر نوع العملية لمعرفة منفذ كل إجراء وتوقيته الدقيق.',
      },
      {
        titleFr: 'Mettre à jour le Cadre Légal sans redéploiement (effet prospectif)',
        titleAr: 'تحديث الإطار القانوني مباشرة دون إعادة نشر (بأثر مستقبلي)',
        bodyFr:
          'Depuis l’onglet « Cadre Légal », ajustez en français et en arabe les références légales officielles ainsi que les seuils réglementaires (taux par défaut du fonds de réserve pour les nouveaux immeubles, plafond de procurations AG, délais de convocation et de mise en demeure). Les quittances et PV déjà émis conservent leur mention légale d’origine.',
        bodyAr:
          'من تبويب «الإطار القانوني»، يمكنك تعديل المراجع القانونية بالعربية والفرنسية والعتبات التنظيمية (نسبة صندوق الاحتياط الافتراضية للعمارات الجديدة، سقف الوكالات، آجال الاستدعاء والإنذار)، مع الحفاظ التام على المراجع الأصلية للوصولات والمحاضر السابقة.',
      },
    ],
  },
];
