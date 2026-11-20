import type { UserGuideArticle } from './types';

export const SYNDIC_GUIDES: UserGuideArticle[] = [
  {
    id: 'syndic-quickstart',
    role: 'syndic',
    categoryFr: 'Démarrage & Conformité',
    categoryAr: 'الانطلاق والامتثال',
    contextKeys: ['quickstart', 'checklist', 'help'],
    estimatedMinutes: 4,
    titleFr: 'Démarrage Rapide d’un Cabinet Syndic (Checklist Loi 18-00)',
    titleAr: 'الانطلاق السريع لمكتب السنديك (قائمة الجاهزية القانونية 18-00)',
    summaryFr:
      'Suivez ces 5 étapes dans l’ordre lors de la reprise ou création d’une résidence pour obtenir une comptabilité exacte, des votes pondérés conformes et des portails résidents prêts en moins de 15 minutes.',
    summaryAr:
      'اتبع هذه الخطوات الخمس بالترتيب عند إضافة إقامة جديدة لضمان محاسبة دقيقة وتصويت موزون بالأنصبة وتفعيل بوابات السكان في أقل من 15 دقيقة.',
    steps: [
      {
        titleFr: '1. Créer la résidence et renseigner son RIB bancaire (24 chiffres)',
        titleAr: '1. إنشاء العمارة وإدخال رقم الحساب البنكي RIB (24 رقماً)',
        bodyFr:
          'Ouvrez « Immeubles & Résidences » et créez votre résidence avec son adresse complète, sa ville, sa cotisation mensuelle par défaut et le RIB 24 chiffres du compte bancaire dédié de la copropriété (obligatoire selon la Loi 18-00).',
        bodyAr:
          'افتح قسم «العمارات والإقامات» وأنشئ الإقامة مع العنوان الكامل والمدينة وواجب السنديك الشهري ورقم RIB المكون من 24 رقماً للحساب البنكي الخاص بالعمارة.',
      },
      {
        titleFr: '2. Structurer les lots et équilibrer les tantièmes à 1000/1000',
        titleAr: '2. إدخال الشقق وموازنة الأنصبة لتساوي 1000/1000',
        bodyFr:
          'Dans « Lots & Appartements », créez tous les appartements/commerces (individuellement ou en lot) puis ajustez les tantièmes afin que la somme atteigne exactement le total de l’immeuble (1000/1000 ou 10000/10000).',
        bodyAr:
          'في قسم «الشقق والوحدات»، أضف جميع الشقق والمحلات واضبط الأنصبة (التانتييم) لتطابق المجموع الكلي للعمارة بالضبط.',
      },
      {
        titleFr: '3. Ajouter les copropriétaires, les relier aux lots et remettre les fiches PDF',
        titleAr: '3. إضافة الملاك المشتركين وربطهم بالشقق وتسليم بطاقات الولوج PDF',
        bodyFr:
          'Dans « Résidents & Accès », enregistrez chaque copropriétaire (et locataire le cas échéant), rattachez son lot et téléchargez sa Fiche d’Accès PDF individuelle.',
        bodyAr:
          'في «السكان وحسابات الولوج»، سجل كل مالك مشترك (والمكتري إن وجد) واربطه بشقته ثم حمّل بطاقة الولوج PDF لتسليمها له.',
      },
      {
        titleFr: '4. Confirmer les soldes initiaux de trésorerie (Reprise d’exercice)',
        titleAr: '4. تأكيد الأرصدة الافتتاحية للخزينة والمتأخرات السابقة',
        bodyFr:
          'Dans « Comptabilité & Trésorerie », enregistrez la trésorerie initiale (Fonds Courant + Fonds de Réserve) ainsi que les éventuels arriérés d’ouverture des copropriétaires avant de générer le premier appel de fonds mensuel.',
        bodyAr:
          'في قسم «المحاسبة والمالية»، أدخل الرصيد الافتتاحي لصندوق التسيير وصندوق الاحتياط والمتأخرات السابقة قبل إصدار أول طلب واجبات شهري.',
        screenshot: {
          src: '/guides/screenshots/syndic/dashboard.jpg',
          altFr: 'Tableau de bord Syndic présentant la synthèse financière et les indicateurs clés de la résidence',
          altAr: 'لوحة قيادة السنديك تعرض الملخص المالي والمؤشرات الرئيسية للإقامة',
          captionFr:
            'Une fois les 5 étapes cochées, la barre de préparation disparaît et votre tableau de bord reflète la situation réelle.',
          captionAr:
            'بعد إتمام الخطوات الخمس، تختفي قائمة التجهيز وتعرض لوحة القيادة الوضعية الحقيقية للإقامة.',
        },
      },
    ],
    legalNoteFr:
      'Loi 18-00 / 106-12 (Maroc) : chaque syndicat de copropriétaires doit disposer d’un compte bancaire séparé et d’un fonds de réserve dédié aux gros travaux, distinct du budget courant.',
    legalNoteAr:
      'القانون 18-00 / 106-12: يجب أن يتوفر كل اتحاد ملاك مشتركين على حساب بنكي مستقل وصندوق احتياط خاص بالأشغال الكبرى منفصل عن ميزانية التسيير.',
  },
  {
    id: 'syndic-buildings',
    role: 'syndic',
    categoryFr: 'Patrimoine & Résidences',
    categoryAr: 'الإقامات والعمارات',
    contextKeys: ['buildings'],
    estimatedMinutes: 3,
    titleFr: 'Gérer les Immeubles, Coordonnées Bancaires RIB & Capacité Forfait',
    titleAr: 'إدارة العمارات، الحساب البنكي RIB وسعة الباقة',
    summaryFr:
      'Créez vos immeubles, suivez la jauge de capacité de votre forfait SaaS, configurez le RIB bancaire et archivez ou restaurez proprement une résidence.',
    summaryAr:
      'أنشئ العمارات، راقب سعة باقة الاشتراك، أدخل رقم RIB البنكي لكل عمارة وقم بأرشفة أو استعادة أي عمارة بأمان.',
    steps: [
      {
        titleFr: 'Ajouter une nouvelle résidence et configurer ses paramètres de base',
        titleAr: 'إضافة عمارة جديدة وضبط إعداداتها الأساسية',
        bodyFr:
          'Cliquez sur « Ajouter un immeuble », renseignez le nom, l’adresse, la ville, la cotisation syndicale mensuelle de référence, le taux d’affectation au fonds de réserve et le RIB 24 chiffres.',
        bodyAr:
          'اضغط «إضافة عمارة»، أدخل الاسم والعنوان والمدينة ومبلغ الواجب الشهري الافتراضي ونسبة صندوق الاحتياط ورقم RIB من 24 رقماً.',
        screenshot: {
          src: '/guides/screenshots/syndic/buildings.jpg',
          altFr: 'Page Immeubles & Résidences avec jauge de forfait, cartes immeubles et RIB',
          altAr: 'صفحة العمارات والإقامات مع مؤشر سعة الباقة وبطاقات العمارات',
          captionFr:
            'Vue Immeubles : compteur d’utilisation du forfait, sélection active, édition RIB et accès aux immeubles archivés.',
          captionAr:
            'واجهة العمارات: عداد استهلاك الباقة، تعديل RIB والوصول إلى العمارات المؤرشفة.',
        },
      },
      {
        titleFr: 'Archiver ou restaurer un immeuble sans perdre l’historique comptable',
        titleAr: 'أرشفة أو استعادة عمارة دون فقدان السجل المحاسبي',
        bodyFr:
          'L’archivage libère un emplacement de votre forfait tout en conservant intégralement les archives comptables et PV. L’archivage est automatiquement bloqué si une AG est ouverte au vote ou si un justificatif bancaire attend validation.',
        bodyAr:
          'الأرشفة تحرر مكاناً في باقة اشتراكك مع الاحتفاظ الكامل بالأرشيف المحاسبي والمحاضر، وتُمنع تلقائياً إذا كان هناك جمع عام مفتوح أو وصل ينتظر المصادقة.',
      },
    ],
  },
  {
    id: 'syndic-dashboard',
    role: 'syndic',
    categoryFr: 'Pilotage Quotidien',
    categoryAr: 'القيادة اليومية',
    contextKeys: ['dashboard', ''],
    estimatedMinutes: 2,
    titleFr: 'Lire le Tableau de Bord & KPIs de la Résidence',
    titleAr: 'قراءة لوحة القيادة والمؤشرات المالية والتقنية',
    summaryFr:
      'Surveillez en un coup d’œil le taux de recouvrement, la trésorerie courante et de réserve, les impayés prioritaires et les tickets de maintenance ouverts.',
    summaryAr:
      'راقب في لمحة واحدة نسبة التحصيل ورصيد الخزينة وصندوق الاحتياط والمتأخرات وأعطاب الصيانة المفتوحة.',
    steps: [
      {
        titleFr: 'Basculer entre vos immeubles depuis le sélecteur latéral',
        titleAr: 'التبديل بين العمارات من القائمة الجانبية',
        bodyFr:
          'Dans la barre latérale gauche, utilisez le sélecteur de résidence : toutes les vues (Tableau de bord, Finances, AG, Maintenance) se synchronisent instantanément sur l’immeuble choisi.',
        bodyAr:
          'من القائمة الجانبية، اختر العمارة المطلوبة لتتحدث جميع الأقسام فوراً ببيانات تلك العمارة.',
      },
      {
        titleFr: 'Exploiter les cartes KPI et raccourcis d’action rapide',
        titleAr: 'استغلال بطاقات المؤشرات واختصارات الإجراءات السريعة',
        bodyFr:
          'Contrôlez le solde de trésorerie, les cotisations encaissées vs impayées, les demandes de paiement en attente et les incidents urgents. Cliquez sur un indicateur pour accéder directement au module correspondant.',
        bodyAr:
          'راقب رصيد الخزينة والواجبات المحصلة مقابل المتأخرات وطلبات المصادقة والأعطاب العاجلة، واضغط على أي مؤشر للانتقال مباشرة إلى قسمه.',
        screenshot: {
          src: '/guides/screenshots/syndic/dashboard.jpg',
          altFr: 'Tableau de bord principal du Syndic avec KPIs financiers et opérationnels',
          altAr: 'لوحة القيادة الرئيسية للسنديك مع المؤشرات المالية والتشغيلية',
          captionFr:
            'Tableau de bord temps réel synchronisé par SSE sur l’ensemble des postes du cabinet.',
          captionAr:
            'لوحة قيادة فورية متزامنة تلقائياً عبر جميع أجهزة المكتب.',
        },
      },
    ],
  },
  {
    id: 'syndic-apartments',
    role: 'syndic',
    categoryFr: 'Patrimoine & Résidences',
    categoryAr: 'الإقامات والعمارات',
    contextKeys: ['apartments'],
    estimatedMinutes: 3,
    titleFr: 'Lots, Appartements & Répartition des Tantièmes (1000/1000)',
    titleAr: 'الشقق والوحدات وتوزيع الأنصبة (1000/1000)',
    summaryFr:
      'Créez vos lots unitairement ou en masse, vérifiez l’équilibre des tantièmes de copropriété et exportez l’état descriptif de division en PDF.',
    summaryAr:
      'أضف الشقق والمحلات بشكل فردي أو جماعي، تأكد من توازن الأنصبة (1000/1000) وصدّر لائحة الوحدات بصيغة PDF.',
    steps: [
      {
        titleFr: 'Ajouter des lots ou utiliser la création en masse',
        titleAr: 'إضافة الشقق بشكل فردي أو جماعي',
        bodyFr:
          'Cliquez sur « Ajouter un lot » (ou « Génération en lot ») en indiquant le numéro (ex. A1, B2), l’étage, la superficie en m², les tantièmes et la cotisation mensuelle.',
        bodyAr:
          'اضغط «إضافة شقة» أو «إنشاء جماعي»، وأدخل رقم الشقة والطابق والمساحة بالمتر المربع والأنصبة والواجب الشهري.',
        screenshot: {
          src: '/guides/screenshots/syndic/apartments.jpg',
          altFr: 'Module Lots & Appartements avec barre d’équilibre des tantièmes et export PDF',
          altAr: 'وحدة الشقق والوحدات مع شريط توازن الأنصبة وتصدير PDF',
          captionFr:
            'Gestion des lots : contrôle d’équilibre 1000/1000 tantièmes, rééquilibrage automatique et export PDF.',
          captionAr:
            'إدارة الشقق: مراقبة توازن الأنصبة 1000/1000 وإعادة التوزيع التلقائي وتصدير PDF.',
        },
      },
      {
        titleFr: 'Rééquilibrer les tantièmes et exporter le tableau PDF',
        titleAr: 'إعادة موازنة الأنصبة وتصدير الجدول بصيغة PDF',
        bodyFr:
          'Si la somme diffère du total de l’immeuble, utilisez l’assistant de rééquilibrage proportionnel (surface ou parts égales) ou ajustez chaque lot selon le règlement de copropriété. Cliquez sur « Exporter PDF » pour imprimer l’état des lots.',
        bodyAr:
          'إذا اختلف المجموع عن الإجمالي القانوني، استخدم أداة إعادة الموازنة أو عدّل كل شقة حسب النظام الأساسي للعمارة، ثم اضغط «تصدير PDF».',
      },
    ],
  },
  {
    id: 'syndic-residents',
    role: 'syndic',
    categoryFr: 'Copropriétaires & Accès',
    categoryAr: 'الملاك والسكان',
    contextKeys: ['residents'],
    estimatedMinutes: 3,
    titleFr: 'Résidents, Copropriétaires & Fiches d’Accès PDF',
    titleAr: 'السكان والملاك المشتركين وبطاقات الولوج PDF',
    summaryFr:
      'Enregistrez propriétaires et locataires, liez-les à leurs lots (y compris multi-lots), générez leurs accès sécurisés et imprimez leur Fiche d’Identifiants PDF.',
    summaryAr:
      'سجل الملاك والمكترين واربطهم بشققهم، أنشئ حسابات الولوج الآمنة واطبع بطاقة الدخول PDF لكل ساكن.',
    steps: [
      {
        titleFr: 'Ajouter un copropriétaire ou locataire et créer son compte portail',
        titleAr: 'إضافة مالك أو مكتري وتفعيل حسابه على البوابة',
        bodyFr:
          'Cliquez sur « Nouveau Résident », renseignez le nom complet, l’email, le GSM, le N° CIN, la qualité (Copropriétaire Titulaire ou Locataire Occupant) et sélectionnez le ou les lots rattachés. Cochez la génération d’accès pour créer un mot de passe temporaire sécurisé.',
        bodyAr:
          'اضغط «ساكن جديد»، أدخل الاسم الكامل والبريد والهاتف ورقم CIN والصفة (مالك مشترك أو مكتري) واربطه بالشقة مع تفعيل إنشاء كلمة المرور المؤقتة.',
        screenshot: {
          src: '/guides/screenshots/syndic/residents.jpg',
          altFr: 'Annuaire des Résidents & Copropriétaires avec lots liés et boutons d’accès PDF',
          altAr: 'لائحة السكان والملاك المشتركين مع الشقق المرتبطة وأزرار بطاقة الولوج',
          captionFr:
            'Gestion des résidents : distinction Propriétaire / Locataire, téléchargement de la Fiche d’Accès PDF et régénération sécurisée.',
          captionAr:
            'إدارة السكان: تمييز المالك عن المكتري وتحميل بطاقة الولوج PDF وإعادة توليد كلمة المرور عند الحاجة.',
        },
      },
      {
        titleFr: 'Remettre la Fiche d’Accès PDF ou régénérer un mot de passe oublié',
        titleAr: 'تسليم بطاقة الولوج PDF أو إعادة تعيين كلمة مرور منسية',
        bodyFr:
          'Cliquez sur « Fiche PDF » pour imprimer ou envoyer par WhatsApp les identifiants initiaux. Modifier une fiche résident ne réinitialise jamais son mot de passe : utilisez exclusivement le bouton dédié « Régénérer accès » en cas d’oubli.',
        bodyAr:
          'اضغط «بطاقة PDF» لطباعة أو إرسال بيانات الدخول. تعديل بيانات الساكن لا يغيّر كلمة مروره أبداً، ولا تُعاد تهيئتها إلا عبر زر «إعادة توليد الولوج».',
      },
    ],
  },
  {
    id: 'syndic-financials-charges',
    role: 'syndic',
    categoryFr: 'Comptabilité & Trésorerie',
    categoryAr: 'المحاسبة والمالية',
    contextKeys: ['financials'],
    estimatedMinutes: 4,
    titleFr: 'Appels de Fonds, Cotisations Mensuelles & Soldes Initiaux',
    titleAr: 'طلبات الواجبات الشهرية والأرصدة الافتتاحية',
    summaryFr:
      'Initialisez la reprise comptable de la copropriété, générez les appels de charges mensuels en 1 clic et encaissez un paiement direct (Espèces, Chèque, Virement).',
    summaryAr:
      'سجل الأرصدة الافتتاحية للعمارة، أصدر طلبات الواجبات الشهرية بنقرة واحدة وسجل المدفوعات المباشرة (نقداً، شيك، تحويل).',
    steps: [
      {
        titleFr: 'Enregistrer les soldes initiaux de reprise (une seule fois)',
        titleAr: 'تسجيل الأرصدة الافتتاحية (مرة واحدة عند البدء)',
        bodyFr:
          'Dans « Comptabilité & Trésorerie », ouvrez l’assistant « Soldes initiaux » pour saisir le solde bancaire initial du fonds courant, celui du fonds de réserve et les arriérés antérieurs de chaque lot.',
        bodyAr:
          'في قسم «المحاسبة والمالية»، افتح أداة «الأرصدة الافتتاحية» لإدخال الرصيد البنكي الأولي لصندوق التسيير وصندوق الاحتياط والمتأخرات السابقة لكل شقة.',
      },
      {
        titleFr: 'Générer l’appel de cotisations du mois et encaisser un règlement',
        titleAr: 'توليد واجبات الشهر وتسجيل الأداء وإصدار التوصيل',
        bodyFr:
          'Cliquez sur « Générer l’appel du mois » pour créer automatiquement les appels de tous les lots actifs sans doublon. Pour encaisser un règlement au bureau, cliquez sur « Encaisser » sur la ligne du copropriétaire : la quittance PDF est créée instantanément.',
        bodyAr:
          'اضغط «توليد واجبات الشهر» لإنشاء طلبات جميع الشقق تلقائياً دون تكرار. لتسجيل أداء مباشر، اضغط «تحصيل» بجانب الشقة ليصدر التوصيل الرسمي PDF فوراً.',
        screenshot: {
          src: '/guides/screenshots/syndic/financials-charges.jpg',
          altFr: 'Module Comptabilité & Trésorerie affichant la synthèse des fonds et la liste des charges',
          altAr: 'وحدة المحاسبة والمالية تعرض ملخص الصناديق وقائمة الواجبات',
          captionFr:
            'Comptabilité Loi 18-00 : séparation Fonds Courant / Fonds de Réserve, suivi des appels de charges et encaissement rapide.',
          captionAr:
            'محاسبة متوافقة مع القانون 18-00: فصل صندوق التسيير عن صندوق الاحتياط ومتابعة التحصيل.',
        },
      },
    ],
  },
  {
    id: 'syndic-financials-bank',
    role: 'syndic',
    categoryFr: 'Comptabilité & Trésorerie',
    categoryAr: 'المحاسبة والمالية',
    contextKeys: ['financials'],
    estimatedMinutes: 4,
    titleFr: 'Validation des Justificatifs, Rapprochement CSV & Quittances PDF',
    titleAr: 'المصادقة على وصولات السكان، مطابقة كشف البنك CSV والتوصيلات',
    summaryFr:
      'Validez les reçus bancaires soumis par les résidents, importez votre relevé bancaire CSV (Attijariwafa, BCP, CIH, BMCE…) et délivrez les quittances officielles.',
    summaryAr:
      'صادق على وصولات التحويل المرسلة من السكان، استورد كشف الحساب البنكي CSV وأصدر توصيلات الأداء الرسمية PDF.',
    steps: [
      {
        titleFr: 'Contrôler et valider les justificatifs soumis par les copropriétaires',
        titleAr: 'مراجعة والمصادقة على إثباتات الدفع المرسلة من السكان',
        bodyFr:
          'Ouvrez l’onglet « Justificatifs / Banque » dans Finances. Prévisualisez le reçu bancaire téléversé par le résident, vérifiez le montant et la référence sur votre relevé, puis cliquez sur « Approuver » (génère la quittance et crédite le lot) ou « Rejeter » avec un motif.',
        bodyAr:
          'افتح تبويب «الوصولات / البنك» داخل المالية. عاين صورة الوصل وتأكد من المبلغ والمرجع في كشف حسابك، ثم اضغط «مصادقة» لإصدار التوصيل أو «رفض» مع ذكر السبب.',
        screenshot: {
          src: '/guides/screenshots/syndic/financials-bank.jpg',
          altFr: 'Onglet Quittances et Validation bancaire dans le module Finances du Syndic',
          altAr: 'تبويب التوصيلات والمصادقة البنكية في وحدة المالية',
          captionFr:
            'Validation 1-clic des justificatifs, import CSV bancaire et archivage sécurisé des quittances PDF.',
          captionAr:
            'مصادقة فورية على الوصولات ومطابقة كشف الحساب البنكي وأرشيف التوصيلات.',
        },
      },
      {
        titleFr: 'Rapprocher un relevé bancaire CSV en lot',
        titleAr: 'مطابقة كشف الحساب البنكي CSV دفعة واحدة',
        bodyFr:
          'Importez le fichier CSV de votre banque marocaine : l’outil associe automatiquement les virements aux lots correspondants (par référence, nom ou montant) et vous laisse confirmer les écritures avant comptabilisation.',
        bodyAr:
          'استورد ملف CSV من بنكك المغربي ليربط النظام التحويلات بالشقق تلقائياً ويتيح لك تأكيدها قبل الترحيل المحاسبي.',
      },
    ],
  },
  {
    id: 'syndic-financials-expenses',
    role: 'syndic',
    categoryFr: 'Comptabilité & Trésorerie',
    categoryAr: 'المحاسبة والمالية',
    contextKeys: ['financials'],
    estimatedMinutes: 3,
    titleFr: 'Dépenses, Fonds de Réserve, Transferts & Clôture d’Exercice',
    titleAr: 'المصاريف، صندوق الاحتياط، التحويلات وإغلاق السنة المالية',
    summaryFr:
      'Enregistrez vos factures fournisseurs (eau, électricité, gardiennage, ascenseur), gérez les transferts entre fonds courant et réserve, et générez les états comptables.',
    summaryAr:
      'سجل فواتير المزودين والماء والكهرباء والحراسة، وأدر التحويلات بين صندوق التسيير وصندوق الاحتياط وأصدر التقارير المالية.',
    steps: [
      {
        titleFr: 'Saisir une dépense avec justificatif et choix du fonds imputé',
        titleAr: 'تسجيل مصروف مع الفاتورة وتحديد الصندوق المعني',
        bodyFr:
          'Dans l’onglet « Dépenses & Journal », cliquez sur « Nouvelle dépense », sélectionnez le poste (Électricité, Eau, Ascenseur, Nettoyage, Travaux…), choisissez le fonds (Fonds Courant ou Fonds de Réserve), saisissez le montant TTC et joignez la facture.',
        bodyAr:
          'في تبويب «المصاريف والسجل»، اضغط «مصروف جديد»، اختر البند والصندوق (التسيير أو الاحتياط) وأدخل المبلغ وأرفق الفاتورة.',
        screenshot: {
          src: '/guides/screenshots/syndic/financials-expenses.jpg',
          altFr: 'Onglet Dépenses et Journal Comptable dans le module Finances du Syndic',
          altAr: 'تبويب المصاريف والسجل المحاسبي في وحدة المالية',
          captionFr:
            'Journal comptable inaltérable : contre-passation traçable en cas d’erreur, jamais de suppression silencieuse.',
          captionAr:
            'سجل محاسبي غير قابل للتلاعب: يتم التصحيح عبر قيد عكسي موثق بدلاً من الحذف الصامت.',
        },
      },
      {
        titleFr: 'Transférer vers le Fonds de Réserve ou contre-passer une écriture',
        titleAr: 'التحويل إلى صندوق الاحتياط أو إلغاء قيد محاسبي',
        bodyFr:
          'Utilisez « Transfert entre fonds » pour alimenter le fonds de réserve conformément à la décision d’AG. En cas d’erreur sur une dépense, utilisez « Contre-passer / Annuler » avec motif pour préserver la piste d’audit.',
        bodyAr:
          'استخدم «تحويل بين الصناديق» لتغذية صندوق الاحتياط حسب قرار الجمع العام، وعند خطأ في مصروف استخدم «إلغاء بقيد عكسي» للحفاظ على مسار التدقيق.',
      },
    ],
  },
  {
    id: 'syndic-ag',
    role: 'syndic',
    categoryFr: 'Gouvernance Loi 18-00',
    categoryAr: 'الحكامة والقانون 18-00',
    contextKeys: ['ag'],
    estimatedMinutes: 5,
    titleFr: 'Assemblées Générales (AGO/AGE), Convocations, Quorum & PV PDF',
    titleAr: 'الجموع العامة (العادية والاستثنائية)، الاستدعاءات، النصاب والمحضر PDF',
    summaryFr:
      'Organisez vos Assemblées Générales conformes à la Loi 18-00 / 106-12 : 1ère/2ème convocation, feuille de présence et procurations plafonnées, vote en ligne pondéré et génération du PV officiel PDF.',
    summaryAr:
      'نظّم الجموع العامة وفق القانون 18-00 / 106-12: الاستدعاء الأول والثاني، ورقة الحضور والوكالات، التصويت الإلكتروني الموزون وإصدار المحضر الرسمي PDF.',
    steps: [
      {
        titleFr: 'Planifier une AG, choisir la convocation (1ère ou 2ème) et rédiger les résolutions',
        titleAr: 'برمجة جمع عام واختيار رقم الاستدعاء وصياغة القرارات',
        bodyFr:
          'Ouvrez « Assemblées Générales » et cliquez sur « Nouvelle AG ». Définissez le type (AGO ou AGE), le numéro de convocation (1ère avec quorum 50% ou 2ème sans quorum selon Art. 18), la date, puis ajoutez vos résolutions en précisant la majorité légale (Art. 21, Art. 22, Unanimité) et le budget travaux éventuel.',
        bodyAr:
          'افتح قسم «الجمعيات العامة» واضغط «جمع عام جديد». حدد النوع (عادي أو استثنائي) ورقم الاستدعاء والتاريخ ثم أضف القرارات مع الأغلبية القانونية المطلوبة.',
        screenshot: {
          src: '/guides/screenshots/syndic/ag.jpg',
          altFr: 'Module Assemblées Générales avec résolutions, quorum, feuille de présence et boutons PV/Convocation PDF',
          altAr: 'وحدة الجمعيات العامة مع القرارات والنصاب وورقة الحضور وأزرار PDF',
          captionFr:
            'Gouvernance complète : Convocation PDF, feuille de présence, plafond 3 procurations / 10% tantièmes et PV PDF.',
          captionAr:
            'حكامة متكاملة: استدعاء PDF، ورقة الحضور، سقف الوكالات وإصدار المحضر الرسمي PDF.',
        },
      },
      {
        titleFr: 'Gérer la feuille de présence, les procurations (Art. 16-6) et ouvrir le vote',
        titleAr: 'إدارة ورقة الحضور والوكالات (المادة 16-6) وفتح التصويت',
        bodyFr:
          'Téléchargez la « Convocation PDF » à envoyer aux copropriétaires (15 jours avant). Le jour J, pointez les présents et représentés : le système contrôle automatiquement le plafond légal (max 3 procurations et ≤ 10% des tantièmes par mandataire, syndic exclu). Ouvrez ensuite le vote en ligne.',
        bodyAr:
          'حمّل «الاستدعاء PDF» لإرساله للملاك قبل 15 يوماً. يوم الاجتماع سجّل الحاضرين والوكالات مع مراقبة تلقائية للسقف القانوني (3 وكالات كحد أقصى ولا تتجاوز 10% من الأنصبة)، ثم افتح التصويت.',
      },
      {
        titleFr: 'Clôturer l’AG, télécharger le PV officiel PDF et générer les appels travaux',
        titleAr: 'إغلاق الجمع العام وتحميل المحضر الرسمي وتوليد طلبات الأشغال',
        bodyFr:
          'Cliquez sur « Clôturer l’AG » : les résultats définitifs et réserves deviennent visibles par tous les copropriétaires, et le « PV Officiel PDF » (sans filigrane brouillon) est prêt à signer. Si une résolution travaux budgétée est adoptée, générez directement les appels de fonds répartis aux tantièmes.',
        bodyAr:
          'اضغط «إغلاق الجمع العام» لنشر النتائج النهائية وتحميل «المحضر الرسمي PDF». وإذا تمت المصادقة على ميزانية أشغال، يمكنك توليد طلبات المساهمة موزعة بالأنصبة بنقرة واحدة.',
      },
    ],
    legalNoteFr:
      'Conformité Art. 16-6, 16-8, 16-10 et Art. 18 (Loi 18-00 modifiée par 106-12) : les brouillons de PV avant clôture portent automatiquement un filigrane « BROUILLON ».',
    legalNoteAr:
      'الامتثال للمواد 16-6 و16-8 و16-10 و18 من القانون 18-00 المعدل بـ 106-12: تحمل مسودات المحضر قبل الإغلاق علامة «مسودة» تلقائياً.',
  },
  {
    id: 'syndic-maintenance',
    role: 'syndic',
    categoryFr: 'Technique & Maintenance',
    categoryAr: 'التقنية والصيانة',
    contextKeys: ['maintenance'],
    estimatedMinutes: 3,
    titleFr: 'Suivi des Incidents, Priorités & Affectation Prestataire',
    titleAr: 'تتبع الأعطاب، الأولويات وتعيين مقدمي الخدمات',
    summaryFr:
      'Centralisez les signalements des résidents et du gardien, priorisez les urgences, assignez un prestataire agréé et contrôlez la clôture des réparations.',
    summaryAr:
      'اجمع بلاغات السكان والحارس، رتب الأولويات، عيّن الحرفي المعتمد وراقب إغلاق الإصلاحات.',
    steps: [
      {
        titleFr: 'Filtrer les incidents et affecter un prestataire agréé',
        titleAr: 'تصفية الأعطاب وتعيين مقدم خدمة معتمد',
        bodyFr:
          'Dans « Maintenance & Dépannages », ouvrez un ticket « En attente », vérifiez les photos jointes, ajustez la priorité (Basse, Moyenne, Haute, Urgence) et assignez le prestataire compétent. Celui-ci le voit immédiatement dans son portail Prestataire.',
        bodyAr:
          'في قسم «الصيانة والتدخلات»، افتح العطب المعلق، عاين الصور، حدد الأولوية وعيّن المزود المختص ليظهر له فوراً في بوابته.',
        screenshot: {
          src: '/guides/screenshots/syndic/maintenance.jpg',
          altFr: 'Tableau de gestion Maintenance & Dépannages du Syndic avec filtres et assignation',
          altAr: 'لوحة الصيانة والتدخلات للسنديك مع التصفية وتعيين المزودين',
          captionFr:
            'Gestion des tickets : badges d’urgence, affectation prestataire, historique horodaté et réouverture contrôlée.',
          captionAr:
            'إدارة تذاكر الصيانة: شارات الاستعجال وتعيين الحرفي وسجل التتبع.',
        },
      },
      {
        titleFr: 'Vérifier la clôture ou rouvrir un ticket si l’intervention est incomplète',
        titleAr: 'التحقق من الإغلاق أو إعادة فتح العطب عند الحاجة',
        bodyFr:
          'Une fois le ticket marqué « Terminé » par le prestataire, vérifiez son compte-rendu technique. Si une reprise est nécessaire, utilisez le bouton « Rouvrir » (réservé au Syndic).',
        bodyAr:
          'بعد إغلاق التذكرة من المزود، راجع التقرير التقني. وإذا تطلّب الأمر تدخلاً إضافياً، استخدم زر «إعادة فتح» الحصري للسنديك.',
      },
    ],
  },
  {
    id: 'syndic-prestataires',
    role: 'syndic',
    categoryFr: 'Technique & Maintenance',
    categoryAr: 'التقنية والصيانة',
    contextKeys: ['prestataires'],
    estimatedMinutes: 3,
    titleFr: 'Annuaire Prestataires Agréés (ICE/RC/RIB) & Fiches d’Accès',
    titleAr: 'دليل مقدمي الخدمات المعتمدين (ICE/RC/RIB) وبطاقات الولوج',
    summaryFr:
      'Référencez vos partenaires techniques avec leurs identifiants légaux marocains, générez leurs accès portail et suspendez instantanément un contrat résilié.',
    summaryAr:
      'سجل شركاءك التقنيين بمعرفاتهم القانونية المغربية، أنشئ لهم حسابات بوابة المزود وأوقف صلاحيات أي عقد منتهي فوراً.',
    steps: [
      {
        titleFr: 'Ajouter un prestataire avec ICE, RC, spécialité et accès portail',
        titleAr: 'إضافة مقدم خدمة مع ICE و RC والتخصص وحساب البوابة',
        bodyFr:
          'Dans « Prestataires & Contrats », cliquez sur « Ajouter un prestataire », renseignez la raison sociale, le responsable, le téléphone d’astreinte, la spécialité, l’ICE et le RC, puis activez la création d’accès portail.',
        bodyAr:
          'في «مقدمو الخدمات والعقود»، اضغط «إضافة مزود»، أدخل الاسم التجاري والمسؤول ورقم الهاتف والتخصص و ICE و RC مع تفعيل حساب البوابة.',
        screenshot: {
          src: '/guides/screenshots/syndic/prestataires.jpg',
          altFr: 'Annuaire des Prestataires Agréés dans le portail Syndic avec ICE/RC et fiche d’accès',
          altAr: 'دليل مقدمي الخدمات المعتمدين في بوابة السنديك',
          captionFr:
            'Fiches prestataires complètes : spécialités, coordonnées légales, notes des résidents et Fiche d’Accès PDF.',
          captionAr:
            'بطاقات المزودين الكاملة: التخصص والبيانات القانونية وتقييمات السكان وبطاقة الولوج PDF.',
        },
      },
      {
        titleFr: 'Télécharger la Fiche d’Accès PDF ou désactiver un compte',
        titleAr: 'تحميل بطاقة الولوج PDF أو تعطيل الحساب',
        bodyFr:
          'Remettez la « Fiche PDF » à votre partenaire. Si vous cessez de travailler avec un prestataire, passez son statut en inactif ou archivez-le : sa session est immédiatement révoquée et ses tickets ouverts sont désassignés.',
        bodyAr:
          'سلّم «بطاقة PDF» لشريكك. وعند إنهاء التعاقد، قم بتعطيله أو أرشفته لإلغاء جلسته فوراً وفك ارتباطه بالتذاكر المفتوحة.',
      },
    ],
  },
  {
    id: 'syndic-documents',
    role: 'syndic',
    categoryFr: 'Archives & Communication',
    categoryAr: 'الأرشيف والتواصل',
    contextKeys: ['documents'],
    estimatedMinutes: 2,
    titleFr: 'Coffre-fort Documents & Contrôle de Visibilité',
    titleAr: 'أرشيف الوثائق وضبط صلاحيات الاطلاع',
    summaryFr:
      'Classez vos contrats, assurances, règlements et PV en choisissant précisément qui peut les consulter (Tous les résidents, Propriétaires uniquement ou Syndic uniquement).',
    summaryAr:
      'رتب عقود الإقامة والتأمين والنظام الداخلي والمحاضر مع تحديد دقيق لمن يحق له الاطلاع عليها (الجميع، الملاك فقط أو السنديك فقط).',
    steps: [
      {
        titleFr: 'Téléverser un document et définir son niveau de confidentialité',
        titleAr: 'رفع وثيقة وتحديد مستوى السرية والاطلاع',
        bodyFr:
          'Dans « Archives & Documents », choisissez la catégorie, sélectionnez la visibilité (« Tous les résidents », « Copropriétaires uniquement » ou « Syndic uniquement ») puis importez votre fichier PDF ou image (max 5 Mo).',
        bodyAr:
          'في «الأرشيف والوثائق»، اختر الفئة وحدد صلاحية الاطلاع (جميع السكان، الملاك فقط أو السنديك فقط) ثم ارفع ملف PDF أو الصورة (5 ميجا كحد أقصى).',
        screenshot: {
          src: '/guides/screenshots/syndic/documents.jpg',
          altFr: 'Coffre-fort Archives & Documents avec badges de visibilité et catégories',
          altAr: 'خزينة الأرشيف والوثائق مع شارات الصلاحية والتصنيفات',
          captionFr:
            'Stockage sécurisé authentifié : chaque fichier supprimé est immédiatement inaccessible et purgé.',
          captionAr:
            'تخزين آمن ومصادق عليه مع تحكم فوري في الصلاحيات والحذف.',
        },
      },
    ],
  },
  {
    id: 'syndic-comms',
    role: 'syndic',
    categoryFr: 'Archives & Communication',
    categoryAr: 'الأرشيف والتواصل',
    contextKeys: ['announcements', 'chat'],
    estimatedMinutes: 2,
    titleFr: 'Annonces Officielles & Modération de la Messagerie',
    titleAr: 'الإعلانات الرسمية وإشراف المحادثات الجماعية',
    summaryFr:
      'Diffusez les avis importants (coupure d’eau, entretien ascenseur, convocation AG) avec priorité Normale ou Urgente, et modérez la messagerie interne de la résidence.',
    summaryAr:
      'انشر الإعلانات المهمة (انقطاع الماء، صيانة المصعد، موعد الجمع العام) بدرجة عادية أو عاجلة، وأشرف على المحادثات الداخلية.',
    steps: [
      {
        titleFr: 'Publier une annonce officielle (Normale ou Urgente)',
        titleAr: 'نشر إعلان رسمي (عادي أو عاجل)',
        bodyFr:
          'Dans « Annonces Officielles », saisissez le titre, le message et choisissez la priorité (« Urgente » affiche un bandeau d’alerte rouge visible immédiatement sur le portail de tous les habitants et génère une notification).',
        bodyAr:
          'في «الإعلانات الرسمية»، اكتب العنوان والمضمون وحدد الأولوية («عاجل» يظهر بشريط تنبيه أحمر في بوابة جميع السكان مع إشعار فوري).',
        screenshot: {
          src: '/guides/screenshots/syndic/announcements.jpg',
          altFr: 'Vue Annonces Officielles du Syndic avec niveau de priorité Normal ou Urgent',
          altAr: 'صفحة الإعلانات الرسمية للسنديك مع اختيار الأولوية',
          captionFr:
            'Diffusion instantanée aux résidents avec horodatage et gestion des priorités.',
          captionAr:
            'نشر فوري للسكان مع التأريخ وتحديد مستوى الاستعجال.',
        },
      },
      {
        titleFr: 'Participer et modérer la Messagerie Communautaire',
        titleAr: 'المشاركة والإشراف على المحادثات الجماعية',
        bodyFr:
          'Dans « Messagerie », répondez directement aux questions des habitants dans les canaux thématiques et supprimez tout message inapproprié grâce au bouton de modération Syndic.',
        bodyAr:
          'في «المحادثات»، أجب على استفسارات السكان في القنوات الموضوعاتية واحذف أي رسالة مخالفة عبر صلاحية إشراف السنديك.',
        screenshot: {
          src: '/guides/screenshots/syndic/chat.jpg',
          altFr: 'Messagerie communautaire dans le portail Syndic avec canaux et modération',
          altAr: 'المحادثات الجماعية في بوابة السنديك مع أدوات الإشراف',
          captionFr:
            'Canaux séparés (Général, Entraide, Alertes) et modération directe par le Syndic.',
          captionAr:
            'قنوات منفصلة للتواصل مع إشراف مباشر من السنديك.',
        },
      },
    ],
  },
  {
    id: 'syndic-marketplace',
    role: 'syndic',
    categoryFr: 'Archives & Communication',
    categoryAr: 'الأرشيف والتواصل',
    contextKeys: ['marketplace'],
    estimatedMinutes: 2,
    titleFr: 'Modérer Le Souk de la Résidence',
    titleAr: 'إدارة ومراقبة سوق الإقامة',
    summaryFr:
      'Supervisez les petites annonces publiées entre voisins, échangez en message privé avec un annonceur ou retirez une annonce non conforme.',
    summaryAr:
      'راقب الإعلانات المنشورة بين الجيران، تواصل مع صاحب الإعلان أو احذف أي إعلان غير ملائم.',
    steps: [
      {
        titleFr: 'Consulter les annonces actives et modérer si besoin',
        titleAr: 'مراجعة الإعلانات النشطة وحذف المخالف منها عند الحاجة',
        bodyFr:
          'Dans « Souk des Résidents », filtrez les annonces par catégorie ou statut. En tant que Syndic gestionnaire, vous pouvez clôturer ou supprimer une annonce inappropriée (les fils privés associés sont purgés proprement).',
        bodyAr:
          'في «سوق الجيران»، استعرض الإعلانات المصنفة. بصفتك سنديكاً يمكنك إغلاق أو حذف أي إعلان غير مناسب مع تنظيف الرسائل المرتبطة به.',
        screenshot: {
          src: '/guides/screenshots/syndic/marketplace.jpg',
          altFr: 'Vue Le Souk de la Résidence avec cartes d’annonces et outils de modération Syndic',
          altAr: 'واجهة سوق الإقامة مع الإعلانات وأدوات إشراف السنديك',
          captionFr:
            'Modération bienveillante du Souk interne de la copropriété.',
          captionAr:
            'إشراف سلس على سوق الجيران الداخلي للإقامة.',
        },
      },
    ],
  },
  {
    id: 'syndic-settings-billing',
    role: 'syndic',
    categoryFr: 'Cabinet & Abonnement SaaS',
    categoryAr: 'المكتب واشتراك المنصة',
    contextKeys: ['settings', 'analytics', 'billing'],
    estimatedMinutes: 4,
    titleFr: 'Paramètres Cabinet, Rapports & Renouvellement SaaS (CMI, PayPal, RIB, Espèces & Factures PDF)',
    titleAr: 'إعدادات المكتب، التقارير وتجديد الاشتراك (CMI، PayPal، RIB، نقداً والفواتير PDF)',
    summaryFr:
      'Personnalisez les mentions légales de votre cabinet (Logo, ICE, RC, IF, Patente), analysez vos rapports et renouvelez votre abonnement par CMI Maroc, PayPal, Virement RIB ou Espèces/Agences avec téléchargement de vos Factures PDF.',
    summaryAr:
      'خصّص البيانات القانونية لمكتبك (الشعار، ICE، RC، IF، البتانتا)، راجع التقارير وجدّد اشتراكك عبر CMI أو PayPal أو التحويل أو وكالات النقد مع تحميل فواتيرك PDF.',
    steps: [
      {
        titleFr: 'Mettre à jour la fiche fiscale du cabinet et le logo (imprimés sur vos PDF)',
        titleAr: 'تحديث البطاقة الضريبية والشعار للمكتب (تُطبع على جميع ملفات PDF)',
        bodyFr:
          'Ouvrez « Paramètres du Cabinet » pour saisir votre raison sociale, ICE, Identifiant Fiscal, RC, Patente et importer le logo du cabinet. Ces informations figurent sur toutes vos Quittances, Convocations et PV d’AG.',
        bodyAr:
          'افتح «إعدادات المكتب» لإدخال الاسم التجاري و ICE و IF و RC والبتانتا ورفع شعار المكتب لتظهر على التوصيلات والاستدعاءات والمحاضر.',
        screenshot: {
          src: '/guides/screenshots/syndic/settings.jpg',
          altFr: 'Page Paramètres du Cabinet avec coordonnées légales marocaines et logo',
          altAr: 'صفحة إعدادات المكتب مع المعرفات الضريبية المغربية والشعار',
          captionFr:
            'Paramètres protégés contre l’écrasement lors des synchronisations temps réel.',
          captionAr:
            'إعدادات محمية تلقائياً من فقدان التعديلات أثناء التزامن الفوري.',
        },
      },
      {
        titleFr: 'Renouveler votre abonnement (CMI Maroc 3DS, PayPal, Virement RIB ou Espèces/Agences)',
        titleAr: 'تجديد اشتراك المنصة (CMI المغرب، PayPal، تحويل RIB أو وكالات النقد)',
        bodyFr:
          'Cliquez sur « Renouveler / Payer → » dans le bandeau supérieur ou dans le pied de la barre latérale. Choisissez votre forfait et durée (remises multi-mois 3/6/12m affichées en direct), appliquez un éventuel Code Promo puis réglez via l’onglet de votre choix : Carte Marocaine CMI (redirection 3D Secure), PayPal/Carte Internationale, Virement RIB Maroc ou Espèces/Wafacash/Cash Plus/Barid Cash/Chèque.',
        bodyAr:
          'اضغط «تجديد / دفع» من الشريط العلوي أو أسفل القائمة الجانبية. اختر الباقة والمدة (مع خصومات 3/6/12 شهراً)، أدخل رمزاً ترويجياً إن وجد ثم اختر وسيلة الدفع: البطاقة المغربية CMI، أو PayPal، أو التحويل البنكي RIB، أو الإيداع النقدي عبر الوكالات والشيك.',
        screenshot: {
          src: '/guides/screenshots/syndic/renewal-modal.jpg',
          altFr: 'Fenêtre de renouvellement SaaS affichant forfaits, remises multi-mois, code promo, onglets CMI/Virement/Espèces et factures PDF',
          altAr: 'نافذة تجديد الاشتراك تعرض الباقات والخصومات والرمز الترويجي وبوابات الدفع والفواتير',
          captionFr:
            'Paiement multi-passerelles Maroc + section « Mes Factures & Reçus Officiels » avec téléchargement PDF immédiat.',
          captionAr:
            'بوابات دفع متعددة بالمغرب مع قسم «فواتيري ووصولاتي الرسمية» للتحميل الفوري بصيغة PDF.',
        },
      },
      {
        titleFr: 'Télécharger vos Factures & Reçus Officiels PDF',
        titleAr: 'تحميل الفواتير والوصولات الرسمية PDF',
        bodyFr:
          'En bas de la fenêtre de renouvellement, retrouvez toutes vos demandes hors-ligne en cours ainsi que la liste de vos paiements confirmés avec bouton « Facture PDF » comportant ICE, HT, TVA et TTC.',
        bodyAr:
          'في أسفل نافذة التجديد، تجد جميع طلباتك الجارية ولائحة فواتيرك المؤكدة مع زر تحميل «فاتورة PDF» متضمنة لـ ICE وتفاصيل TVA.',
      },
    ],
  },
];
