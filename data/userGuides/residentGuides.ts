import type { UserGuideArticle } from './types';

export const RESIDENT_GUIDES: UserGuideArticle[] = [
  {
    id: 'resident-first-login',
    role: 'resident',
    categoryFr: 'Accès & Sécurité',
    categoryAr: 'الولوج والأمان',
    contextKeys: ['login', 'onboarding', 'overview'],
    estimatedMinutes: 2,
    titleFr: 'Première Connexion Sécurisée & Changement de Mot de Passe',
    titleAr: 'أول تسجيل دخول آمن وتغيير كلمة المرور',
    summaryFr:
      'Activez votre espace Copropriétaire ou Locataire avec la fiche d’accès remise par votre Syndic et définissez votre mot de passe personnel confidentiel.',
    summaryAr:
      'فعّل فضاءك كمالك مشترك أو مكتري باستخدام بطاقة الولوج المسلمة من السنديك واختر كلمة مرورك الشخصية السرية.',
    prerequisitesFr: [
      'Avoir reçu la Fiche d’Identifiants PDF (Email ou N° CIN + Mot de passe temporaire) de votre Syndic.',
    ],
    prerequisitesAr: [
      'استلام بطاقة الولوج PDF (البريد الإلكتروني أو رقم البطاقة الوطنية + كلمة المرور المؤقتة) من السنديك.',
    ],
    steps: [
      {
        titleFr: 'Ouvrir /login et saisir votre email (ou CIN) et mot de passe temporaire',
        titleAr: 'فتح صفحة الدخول وإدخال البريد الإلكتروني أو رقم CIN وكلمة المرور المؤقتة',
        bodyFr:
          'Rendez-vous sur la page de connexion, sélectionnez l’onglet « Connexion », puis saisissez l’identifiant (email ou CIN) et le mot de passe temporaire figurant sur votre fiche d’accès.',
        bodyAr:
          'افتح صفحة تسجيل الدخول، أدخل بريدك الإلكتروني أو رقم بطاقتك الوطنية مع كلمة المرور المؤقتة المكتوبة في بطاقة الولوج.',
        screenshot: {
          src: '/guides/screenshots/resident/login.jpg',
          altFr: 'Écran de connexion sécurisée au portail SyndicUnion Maroc',
          altAr: 'شاشة تسجيل الدخول الآمن إلى بوابة SyndicUnion المغرب',
          captionFr:
            'Page de connexion unique : accès Syndic, Copropriétaire, Locataire et Prestataire Agréé.',
          captionAr:
            'صفحة دخول موحدة للسنديك والملاك المشتركين والمكترين ومقدمي الخدمات.',
        },
      },
      {
        titleFr: 'Définir un mot de passe personnel (minimum 10 caractères)',
        titleAr: 'تعيين كلمة مرور شخصية جديدة (10 أحرف على الأقل)',
        bodyFr:
          'Lors de votre première connexion, un écran de sécurité vous demande obligatoirement de choisir un nouveau mot de passe personnel différent du code temporaire. Une fois validé, vous accédez immédiatement à votre portail.',
        bodyAr:
          'عند أول دخول، يطلب منك النظام اختيار كلمة مرور شخصية جديدة تختلف عن الرمز المؤقت. فور الحفظ تدخل مباشرة إلى فضائك الشخصي.',
      },
    ],
  },
  {
    id: 'resident-charges',
    role: 'resident',
    categoryFr: 'Charges & Quittances',
    categoryAr: 'الواجبات والتوصيلات',
    contextKeys: ['overview', 'charges', 'payments'],
    estimatedMinutes: 3,
    titleFr: 'Consulter mes Charges, Envoyer un Justificatif & Télécharger mes Quittances PDF',
    titleAr: 'الاطلاع على واجباتي، إرسال وصل الأداء وتحميل التوصيلات PDF',
    summaryFr:
      'Suivez votre solde en temps réel, envoyez votre justificatif de virement bancaire au Syndic et téléchargez à tout moment vos quittances officielles de copropriété (Loi 18-00).',
    summaryAr:
      'تابع رصيدك المالي في الوقت الفعلي، أرسل إيصال التحويل البنكي للسنديك وحمّل توصيلات الأداء الرسمية PDF في أي وقت.',
    steps: [
      {
        titleFr: 'Consulter le solde, les appels de charges et les quittances',
        titleAr: 'مراجعة الرصيد وطلبات الواجبات الشهرية والتوصيلات',
        bodyFr:
          'Depuis l’onglet « Aperçu / Mes Charges », visualisez votre solde global, vos appels mensuels ou appels travaux (impayés, partiels ou payés) ainsi que la section « Mes Quittances Officielles » avec téléchargement PDF en 1 clic.',
        bodyAr:
          'من تبويب «نظرة عامة / واجباتي»، اطلع على رصيدك الإجمالي وواجبات السنديك الشهرية أو أشغال العمارة، وحمّل توصيلاتك الرسمية بصيغة PDF بنقرة واحدة.',
        screenshot: {
          src: '/guides/screenshots/resident/overview-charges.jpg',
          altFr: 'Tableau de bord Copropriétaire affichant le solde, les charges et les quittances PDF',
          altAr: 'لوحة المالك المشترك تعرض الرصيد والواجبات وتوصيلات PDF',
          captionFr:
            'Vue Copropriétaire : situation du lot, appels de charges, bouton « Payer / Envoyer reçu » et quittances PDF.',
          captionAr:
            'فضاء المالك المشترك: وضعية الشقة، واجبات السنديك وتوصيلات الأداء الرسمية.',
        },
      },
      {
        titleFr: 'Déclarer un virement ou dépôt et joindre le reçu bancaire',
        titleAr: 'التصريح بتحويل بنكي وإرفاق صورة الوصل',
        bodyFr:
          'Cliquez sur « Payer / Envoyer justificatif » sur un appel de charges. Copiez le RIB 24 chiffres de la copropriété, saisissez la référence de votre virement, la banque, la date et importez la photo ou le PDF du reçu. Le Syndic le valide en 1 clic et votre quittance PDF est générée automatiquement.',
        bodyAr:
          'اضغط «دفع / إرسال إثبات» بجانب الواجب المستحق. انسخ رقم RIB الخاص بالعمارة، أدخل مرجع التحويل واسم البنك وأرفق صورة أو ملف PDF للوصل. فور مصادقة السنديك يُصدر لك التوصيل الرسمي تلقائياً.',
        screenshot: {
          src: '/guides/screenshots/resident/payment-modal.jpg',
          altFr: 'Fenêtre d’envoi de justificatif de paiement résident avec RIB de la copropriété',
          altAr: 'نافذة إرسال إثبات الدفع مع رقم RIB للعمارة',
          captionFr:
            'Déclaration de virement avec RIB officiel de la copropriété et téléversement sécurisé du justificatif.',
          captionAr:
            'التصريح بالأداء مع عرض RIB الرسمي للعمارة ورفع آمن للوصل.',
        },
      },
    ],
    legalNoteFr:
      'Chaque quittance générée après validation comporte le numéro séquentiel officiel, les références de la copropriété, le montant en chiffres et en toutes lettres (conforme Loi 18-00).',
    legalNoteAr:
      'كل توصيل أداء يصدر بعد المصادقة يحمل رقماً تسلسلياً رسمياً ومراجع الإقامة والمبلغ بالأرقام والحروف وفقاً للقانون 18-00.',
  },
  {
    id: 'resident-ag-voting',
    role: 'resident',
    categoryFr: 'Assemblées Générales',
    categoryAr: 'الجموع العامة',
    contextKeys: ['voting', 'ag'],
    estimatedMinutes: 3,
    titleFr: 'Voter en Ligne aux Assemblées Générales (Pondération Tantièmes & Multi-Lots)',
    titleAr: 'التصويت الإلكتروني في الجمع العام (حسب الأنصبة وتعدد الشقق)',
    summaryFr:
      'Exercez votre droit de vote de copropriétaire sur chaque résolution de l’AGO/AGE : votre voix est pondérée automatiquement selon les tantièmes officiels de chacun de vos lots.',
    summaryAr:
      'مارس حقك في التصويت كمالك مشترك على كل قرار في الجمع العام، حيث يُحتسب صوتك تلقائياً وفق أنصبة كل شقة تملكها.',
    prerequisitesFr: [
      'Être enregistré en tant que Copropriétaire Titulaire (les locataires ne participent pas au vote AG selon la Loi 18-00).',
      'Une Assemblée Générale doit être ouverte au vote par le Syndic.',
    ],
    prerequisitesAr: [
      'أن تكون مسجلاً كمالك مشترك (المكترون لا يشاركون في تصويت الجمع العام وفق القانون 18-00).',
      'أن يكون السنديك قد فتح باب التصويت للجمع العام.',
    ],
    steps: [
      {
        titleFr: 'Ouvrir l’onglet « Vote AG » et consulter l’ordre du jour',
        titleAr: 'فتح تبويب «تصويت الجمع العام» ومراجعة جدول الأعمال',
        bodyFr:
          'Dans l’onglet « Vote AG », consultez la date de l’assemblée, la règle de majorité requise pour chaque résolution (Art. 21, Art. 22 ou Unanimité) ainsi que le détail budgétaire éventuel.',
        bodyAr:
          'في تبويب «تصويت الجمع العام»، راجع تاريخ الجمع العام ونوع الأغلبية المطلوبة لكل قرار وتفاصيل الميزانية المقترحة.',
        screenshot: {
          src: '/guides/screenshots/resident/ag-voting.jpg',
          altFr: 'Interface de vote en ligne Copropriétaire pour une Assemblée Générale ouverte',
          altAr: 'واجهة التصويت الإلكتروني للمالك المشترك في الجمع العام',
          captionFr:
            'Vote pondéré par tantièmes : choix Pour / Contre / Abstention avec commentaire ou réserve consignée au PV.',
          captionAr:
            'تصويت موزون بالأنصبة: اختيار مع / ضد / ممتنع مع إمكانية إضافة ملاحظة تُسجل في المحضر.',
        },
      },
      {
        titleFr: 'Voter Pour, Contre ou Abstention (lot par lot si multi-propriétaire)',
        titleAr: 'التصويت بـ «مع» أو «ضد» أو «امتناع» (لكل شقة في حال تعدد الأملاك)',
        bodyFr:
          'Si vous possédez plusieurs lots dans la résidence, sélectionnez le lot concerné puis cliquez sur Pour, Contre ou Abstention. Vous pouvez ajouter une réserve écrite qui figurera dans le Procès-Verbal officiel (Art. 16-10).',
        bodyAr:
          'إذا كنت تملك أكثر من شقة، اختر الشقة المعنية ثم اضغط «مع» أو «ضد» أو «امتناع». يمكنك كتابة تحفظ يُدرج رسمياً في محضر الجمع العام.',
        tipFr:
          'Pendant que le scrutin est ouvert, les votes individuels des autres copropriétaires restent confidentiels ; le détail complet est publié à la clôture du PV.',
        tipAr:
          'أثناء فتح التصويت، تبقى اختيارات باقي الملاك سرية وتُنشر النتائج المفصلة عند إغلاق المحضر.',
      },
    ],
  },
  {
    id: 'resident-maintenance',
    role: 'resident',
    categoryFr: 'Maintenance & Dépannages',
    categoryAr: 'الصيانة والأعطاب',
    contextKeys: ['maintenance'],
    estimatedMinutes: 2,
    titleFr: 'Signaler un Incident avec Photos & Suivre la Réparation',
    titleAr: 'التبليغ عن عطب بالصور وتتبع مراحل الإصلاح',
    summaryFr:
      'Déclarez une panne dans les parties communes ou votre lot en joignant une photo, puis suivez chaque étape d’intervention jusqu’à la résolution.',
    summaryAr:
      'صرّح بأي عطب في الأجزاء المشتركة أو شقتك مع إرفاق صورة، وتتبع مراحل الإصلاح خطوة بخطوة حتى الإغلاق.',
    steps: [
      {
        titleFr: 'Créer une déclaration d’incident depuis l’onglet Maintenance',
        titleAr: 'إنشاء بلاغ عطب جديد من تبويب الصيانة',
        bodyFr:
          'Cliquez sur l’onglet « Maintenance » puis sur « Signaler un incident ». Choisissez la catégorie (Plomberie, Électricité, Ascenseur, Parties communes…), le degré d’urgence, précisez si cela concerne votre lot ou les parties communes, ajoutez une photo et envoyez.',
        bodyAr:
          'افتح تبويب «الصيانة» واضغط «التبليغ عن عطب». اختر الفئة (سباكة، كهرباء، مصعد، أجزاء مشتركة...) ومستوى الاستعجال وأرفق صورة واضغط إرسال.',
        screenshot: {
          src: '/guides/screenshots/resident/maintenance.jpg',
          altFr: 'Onglet Maintenance du portail Résident avec liste des tickets et suivi chronologique',
          altAr: 'تبويب الصيانة في بوابة الساكن مع سجل الأعطاب ومراحل المعالجة',
          captionFr:
            'Suivi transparent : statut en temps réel (En attente, En cours, Terminé), prestataire affecté et journal des étapes.',
          captionAr:
            'تتبع شفاف لحالة الإصلاح والمزود المعين وسجل المراحل الزمنية.',
        },
      },
      {
        titleFr: 'Suivre la chronologie d’intervention',
        titleAr: 'متابعة التسلسل الزمني للتدخل التقني',
        bodyFr:
          'Chaque mise à jour effectuée par le Syndic ou le prestataire agréé apparaît dans la chronologie du ticket et déclenche une notification dans la cloche en haut de votre écran.',
        bodyAr:
          'كل تحديث يقوم به السنديك أو الحرفي يظهر في سجل التتبع ويرسل لك إشعاراً فورياً.',
      },
    ],
  },
  {
    id: 'resident-providers',
    role: 'resident',
    categoryFr: 'Prestataires Agréés',
    categoryAr: 'الحرفيون المعتمدون',
    contextKeys: ['providers'],
    estimatedMinutes: 2,
    titleFr: 'Consulter les Prestataires Agréés & Laisser un Avis',
    titleAr: 'الاطلاع على الحرفيين المعتمدين وتقييم خدماتهم',
    summaryFr:
      'Accédez aux coordonnées des artisans vérifiés par votre Syndic (plombier, électricien, ascensoriste…) et partagez un avis objectif après intervention.',
    summaryAr:
      'احصل على أرقام الحرفيين والشركات المعتمدة من السنديك وشارك تقييمك الموضوعي بعد كل تدخل.',
    steps: [
      {
        titleFr: 'Filtrer l’annuaire par spécialité et contacter un prestataire',
        titleAr: 'تصفية الدليل حسب التخصص والتواصل مع الحرفي',
        bodyFr:
          'Ouvrez l’onglet « Prestataires ». Filtrez par spécialité pour retrouver le numéro d’astreinte, le responsable technique et la note moyenne attribuée par les voisins.',
        bodyAr:
          'افتح تبويب «مقدمو الخدمات» وصفِّ حسب التخصص للوصول إلى رقم الهاتف وتقييمات الجيران.',
        screenshot: {
          src: '/guides/screenshots/resident/providers.jpg',
          altFr: 'Annuaire des Prestataires Agréés vu par le Résident avec notes et avis',
          altAr: 'دليل مقدمي الخدمات المعتمدين في بوابة الساكن مع التقييمات',
          captionFr:
            'Annuaire vérifié par le Syndic avec spécialités, contacts directs et système d’avis limité à 1 avis par résident.',
          captionAr:
            'دليل معتمد من السنديك مع أرقام الاتصال ونظام تقييم موثوق.',
        },
      },
      {
        titleFr: 'Noter une intervention (1 à 5 étoiles)',
        titleAr: 'إضافة تقييم بعد التدخل (من 1 إلى 5 نجوم)',
        bodyFr:
          'Cliquez sur « Laisser un avis », choisissez une note entre 1 et 5 étoiles et ajoutez un bref retour d’expérience utile pour les autres habitants.',
        bodyAr:
          'اضغط «إضافة تقييم»، اختر عدداً من 1 إلى 5 نجوم واكتب ملاحظة مفيدة لباقي سكان الإقامة.',
      },
    ],
  },
  {
    id: 'resident-chat-docs',
    role: 'resident',
    categoryFr: 'Vie de Résidence & Documents',
    categoryAr: 'حياة الإقامة والوثائق',
    contextKeys: ['chat', 'documents', 'announcements'],
    estimatedMinutes: 2,
    titleFr: 'Messagerie d’Entraide, Annonces & Documents Officiels',
    titleAr: 'المحادثات الجماعية، الإعلانات الرسمية والوثائق',
    summaryFr:
      'Échangez avec vos voisins dans les canaux dédiés (Général, Entraide, Alertes), lisez les annonces urgentes du Syndic et consultez les PV et règlements.',
    summaryAr:
      'تواصل مع جيرانك عبر قنوات الدردشة، واطلع على إعلانات السنديك ومحاضر الجموع العامة والنظام الداخلي.',
    steps: [
      {
        titleFr: 'Participer aux canaux de discussion de l’immeuble',
        titleAr: 'المشاركة في قنوات التواصل الخاصة بالعمارة',
        bodyFr:
          'Dans l’onglet « Messagerie », sélectionnez le canal approprié (Général, Entraide voisins, Sécurité / Alertes) pour poser une question, signaler un colis ou partager une information utile.',
        bodyAr:
          'في تبويب «المحادثات»، اختر القناة المناسبة للتواصل مع الجيران أو مشاركة معلومة تهم الإقامة.',
        screenshot: {
          src: '/guides/screenshots/resident/chat.jpg',
          altFr: 'Messagerie communautaire de la résidence dans le portail Résident',
          altAr: 'فضاء المحادثات الجماعية في بوابة الساكن',
          captionFr:
            'Messagerie interne organisée par canaux thématiques avec réactions et modération par le Syndic.',
          captionAr:
            'محادثات داخلية منظمة حسب المواضيع بإشراف السنديك.',
        },
      },
      {
        titleFr: 'Télécharger les documents officiels (Règlement, PV AG, Assurances)',
        titleAr: 'تحميل الوثائق الرسمية (النظام الداخلي، المحاضر، التأمين)',
        bodyFr:
          'Depuis l’onglet « Aperçu », accédez à la bibliothèque des documents autorisés pour votre profil (les documents réservés aux propriétaires ne sont visibles que par les titulaires de lots).',
        bodyAr:
          'من الصفحة الرئيسية، افتح مكتبة الوثائق المصرح بها لحسابك للاطلاع على المحاضر والنظام الداخلي وتحميلها.',
      },
    ],
  },
  {
    id: 'resident-marketplace',
    role: 'resident',
    categoryFr: 'Le Souk de la Résidence',
    categoryAr: 'سوق الإقامة',
    contextKeys: ['marketplace'],
    estimatedMinutes: 2,
    titleFr: 'Publier & Échanger sur Le Souk de la Résidence',
    titleAr: 'النشر والبيع والتبادل في سوق الإقامة',
    summaryFr:
      'Vendez, donnez ou proposez un service de proximité entre voisins de confiance au sein de votre immeuble avec messagerie privée sécurisée.',
    summaryAr:
      'بع أو تبرع أو اقترح خدمات بين جيران إقامتك بكل ثقة مع رسائل خاصة آمنة.',
    steps: [
      {
        titleFr: 'Publier une annonce (Vente, Don gratuit ou Service)',
        titleAr: 'نشر إعلان جديد (بيع، تبرع مجاني أو خدمة)',
        bodyFr:
          'Ouvrez l’onglet « Le Souk », cliquez sur « Publier une annonce », renseignez le titre, la catégorie, le prix en MAD (0 MAD pour un don gratuit), ajoutez une photo et publiez.',
        bodyAr:
          'افتح تبويب «سوق الإقامة»، اضغط «نشر إعلان»، أدخل العنوان والفئة والسعر بالدرهم (0 درهم للتبرع المجاني) وأرفق صورة.',
        screenshot: {
          src: '/guides/screenshots/resident/marketplace.jpg',
          altFr: 'Le Souk des Résidents permettant d’acheter, donner ou échanger entre voisins',
          altAr: 'سوق الجيران للبيع والتبرع وتبادل الخدمات داخل الإقامة',
          captionFr:
            'Le Souk privé de la résidence : filtres par catégorie, prix en MAD et messagerie directe avec le vendeur.',
          captionAr:
            'السوق الخاص بالإقامة مع تصنيف حسب الفئة ومراسلة خاصة مع البائع.',
        },
      },
      {
        titleFr: 'Contacter un voisin en message privé et marquer comme Vendu',
        titleAr: 'مراسلة الجار بشكل خاص وتحديث حالة الإعلان إلى «تم البيع»',
        bodyFr:
          'Cliquez sur « Contacter » sur une annonce pour ouvrir un fil de discussion privé entre vous et l’auteur (invisible dans le chat public). Une fois l’objet cédé, marquez votre annonce « Vendu / Clôturé ».',
        bodyAr:
          'اضغط «تواصل» لفتح محادثة خاصة وسرية مع صاحب الإعلان. بعد إتمام الاتفاق حدّث حالة إعلانك إلى «مباع / مغلق».',
      },
    ],
  },
];
