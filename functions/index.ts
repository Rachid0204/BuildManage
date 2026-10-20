import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID || 'ai-studio-immogest-6d16b790-183d-49fd-9d4f-086d99dc2be3';

const initializeFirebaseAdmin = (): admin.app.App => {
  if (admin.apps.length) {
    return admin.app();
  }
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawServiceAccount && rawServiceAccount.trim().startsWith('{')) {
    try {
      const cert = JSON.parse(rawServiceAccount) as admin.ServiceAccount;
      return admin.initializeApp({
        credential: admin.credential.cert(cert),
      });
    } catch (err) {
      console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON, falling back to default credentials:', err);
    }
  }
  return admin.initializeApp();
};

const app = initializeFirebaseAdmin();
const db = admin.firestore(app);
try {
  db.settings({ databaseId: FIRESTORE_DATABASE_ID } as admin.firestore.Settings);
} catch {
  // Settings already initialized in warm container
}

// --- CMI Configuration (Server-Side Secrets Only) ---
const getCmiConfig = () => {
  const clientId = process.env.CMI_CLIENT_ID || '';
  const storeKey = process.env.CMI_STORE_KEY || '';
  const gatewayUrl =
    process.env.CMI_GATEWAY_URL || 'https://payment.cmi.co.ma/fim/est3Dgate';
  const enabled =
    process.env.CMI_ENABLED === 'true' &&
    Boolean(clientId) &&
    Boolean(storeKey) &&
    storeKey !== 'MOCK_STORE_KEY';

  return {
    enabled,
    clientId,
    storeKey,
    gatewayUrl,
    currency: '504', // MAD
    lang: 'fr',
    storetype: '3d_pay_hosting',
  };
};

// Utility to chunk arrays for Batch Writes
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
};

// --- Shared Authorization Helpers (Audit Item 05) ---

interface CallerAuthorizationContext {
  uid: string;
  email: string;
  role: string;
  syndicId?: string;
  buildingId?: string;
  residentId?: string;
  isAdmin: boolean;
}

const getCallerAuthorizationContext = async (
  context: functions.https.CallableContext
): Promise<CallerAuthorizationContext> => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
  }

  const uid = context.auth.uid;
  const email = (context.auth.token.email || '').trim().toLowerCase();
  const userSnap = await db.collection('users').doc(uid).get();
  const adminSnap = await db.collection('admins').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : undefined;

  const isBootstrappedAdmin =
    Boolean(context.auth.token.email_verified) && email === 'wahbi.rachid@gmail.com';
  const isAdmin =
    isBootstrappedAdmin ||
    adminSnap.exists ||
    context.auth.token.role === 'admin' ||
    userData?.role === 'admin';

  return {
    uid,
    email,
    role: isAdmin ? 'admin' : String(userData?.role || context.auth.token.role || 'resident'),
    syndicId: userData?.syndicId,
    buildingId: userData?.buildingId,
    residentId: userData?.residentId,
    isAdmin,
  };
};

const assertSyndicOrAdminForBuilding = async (
  caller: CallerAuthorizationContext,
  syndicId?: string,
  buildingId?: string
): Promise<{ syndicId: string; buildingId?: string }> => {
  if (caller.role !== 'syndic' && !caller.isAdmin) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only an authorized syndic or administrator can perform this operation.'
    );
  }

  const effectiveSyndicId = syndicId || caller.syndicId;
  if (!effectiveSyndicId) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Caller is not associated with a valid syndic tenant.'
    );
  }

  const syndicSnap = await db.collection('syndics').doc(effectiveSyndicId).get();
  if (!syndicSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Syndic tenant not found.');
  }
  const syndicData = syndicSnap.data() || {};

  if (
    !caller.isAdmin &&
    syndicData.createdBy !== caller.uid &&
    caller.syndicId !== effectiveSyndicId
  ) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Cross-tenant access denied for the requested syndic.'
    );
  }

  // Enforce subscription status server-side (Audit Item 21)
  if (!caller.isAdmin) {
    const expiry = syndicData.subscriptionExpiry || syndicData.subscriptionExpiresAt;
    if (
      syndicData.subscriptionStatus === 'expired' ||
      syndicData.subscriptionStatus === 'cancelled' ||
      (expiry && new Date(expiry).getTime() < Date.now())
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Syndic subscription is expired or inactive.'
      );
    }
  }

  if (buildingId) {
    const embeddedBuildings: Array<{ id?: string }> = Array.isArray(syndicData.buildings)
      ? syndicData.buildings
      : [];
    const inSyndicDoc = embeddedBuildings.some((b) => b && b.id === buildingId);
    if (!inSyndicDoc) {
      const buildingSnap = await db.collection('buildings').doc(buildingId).get();
      if (!buildingSnap.exists || buildingSnap.data()?.syndicId !== effectiveSyndicId) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Building does not belong to the authorized syndic tenant.'
        );
      }
    }
  }

  return { syndicId: effectiveSyndicId, buildingId };
};

/**
 * Helper to send email using native fetch (Node 20+)
 */
const sendEmail = async (to: string, subject: string, body: string) => {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

  if (!SENDGRID_API_KEY) {
    functions.logger.info(`[EMAIL SIMULATION] API Key missing. To: ${to}`);
    return;
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: 'noreply@syndik.ma', name: 'Syndic App' },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      functions.logger.error('Error sending email', errorData);
    } else {
      functions.logger.info(`Email sent to ${to}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    functions.logger.error('Network error sending email', message);
  }
};

/**
 * Helper to create in-app notification
 */
const createNotification = async (
  userId: string,
  title: string,
  message: string,
  type: string
) => {
  await db.collection('notifications').add({
    userId,
    title,
    message,
    type,
    read: false,
    createdAt: new Date().toISOString(),
  });
};

// --- CMI Helper Functions (Audit Item 04) ---

const calculateCmiHash = (params: Record<string, string>, storeKey: string): string => {
  const sortedKeys = Object.keys(params)
    .filter((k) => k.toLowerCase() !== 'hash' && k.toLowerCase() !== 'encoding')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  let rawString = '';
  sortedKeys.forEach((key) => {
    const val = String(params[key] ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|');
    rawString += `${val}|`;
  });
  const escapedKey = storeKey.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  rawString += escapedKey;
  return crypto.createHash('sha512').update(rawString, 'utf8').digest('base64');
};

export const generateCmiPaymentData = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAuthorizationContext(context);
  const cmiConfig = getCmiConfig();

  if (!cmiConfig.enabled) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'CMI payment gateway is disabled until production merchant credentials are configured.'
    );
  }

  const invoiceId = typeof data?.invoiceId === 'string' ? data.invoiceId.trim() : '';
  const returnUrl = typeof data?.returnUrl === 'string' ? data.returnUrl.trim() : '';

  if (!invoiceId || !returnUrl) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'invoiceId and returnUrl are required.'
    );
  }

  const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
  if (!invoiceDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Invoice not found.');
  }
  const invoice = invoiceDoc.data() || {};

  // Verify invoice ownership or syndic management before creating a payment session
  const isResidentOwner =
    invoice.residentId === caller.uid ||
    (caller.residentId && invoice.residentId === caller.residentId);

  if (!isResidentOwner) {
    await assertSyndicOrAdminForBuilding(caller, invoice.syndicId, invoice.buildingId);
  }

  if (invoice.status === 'paid') {
    throw new functions.https.HttpsError('failed-precondition', 'Invoice already paid.');
  }

  const numericAmount = Number(invoice.totalAmount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Invalid invoice amount.');
  }

  const amount = numericAmount.toFixed(2);
  const attemptId = `att_${invoiceId}_${Date.now()}`;

  await db.collection('paymentAttempts').doc(attemptId).set({
    id: attemptId,
    invoiceId,
    syndicId: invoice.syndicId || null,
    buildingId: invoice.buildingId || null,
    residentId: invoice.residentId || null,
    expectedAmount: amount,
    currency: cmiConfig.currency,
    clientId: cmiConfig.clientId,
    status: 'initiated',
    createdBy: caller.uid,
    createdAt: new Date().toISOString(),
  });

  const params: Record<string, string> = {
    clientid: cmiConfig.clientId,
    amount,
    okUrl: returnUrl,
    failUrl: returnUrl,
    TranType: 'PreAuth',
    callbackUrl: `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/cmiCallback`,
    shopurl: returnUrl,
    currency: cmiConfig.currency,
    rnd: Date.now().toString(),
    storetype: cmiConfig.storetype,
    hashAlgorithm: 'ver3',
    oid: attemptId,
    lang: cmiConfig.lang,
    email: caller.email || '',
    BillToName: context.auth?.token.name || 'Resident',
  };

  params.HASH = calculateCmiHash(params, cmiConfig.storeKey);

  return {
    action: cmiConfig.gatewayUrl,
    params,
  };
});

export const cmiCallback = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const cmiConfig = getCmiConfig();
  if (!cmiConfig.enabled) {
    res.status(503).send('CMI gateway disabled');
    return;
  }

  const rawBody = (req.body || {}) as Record<string, string>;
  const providedHash = rawBody.HASH || rawBody.hash || '';
  if (!providedHash) {
    functions.logger.warn('Rejected unsigned CMI callback');
    res.status(400).send('Missing signature');
    return;
  }

  const expectedHash = calculateCmiHash(rawBody, cmiConfig.storeKey);
  const providedBuf = Buffer.from(providedHash);
  const expectedBuf = Buffer.from(expectedHash);
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    functions.logger.warn('Rejected CMI callback with invalid signature');
    res.status(403).send('Invalid signature');
    return;
  }

  const attemptId = String(rawBody.oid || '').trim();
  const procReturnCode = String(rawBody.ProcReturnCode || '').trim();
  const callbackAmount = Number(rawBody.amount).toFixed(2);
  const callbackCurrency = String(rawBody.currency || '').trim();
  const callbackClientId = String(rawBody.clientid || '').trim();
  const providerTransId = String(
    rawBody.TransId || rawBody.AuthCode || attemptId
  ).trim();

  if (!attemptId) {
    res.status(400).send('Missing OID');
    return;
  }

  if (procReturnCode === '00' && rawBody.Response === 'Approved') {
    try {
      await db.runTransaction(async (transaction) => {
        const attemptRef = db.collection('paymentAttempts').doc(attemptId);
        const attemptSnap = await transaction.get(attemptRef);
        if (!attemptSnap.exists) {
          throw new Error('Payment attempt not found');
        }
        const attempt = attemptSnap.data() || {};

        if (attempt.status === 'completed') {
          return; // Idempotent replay protection
        }

        if (
          attempt.expectedAmount !== callbackAmount ||
          attempt.currency !== callbackCurrency ||
          attempt.clientId !== callbackClientId
        ) {
          throw new Error('CMI callback parameters do not match initiated payment attempt');
        }

        const replayRef = db.collection('processedPaymentCallbacks').doc(providerTransId);
        const replaySnap = await transaction.get(replayRef);
        if (replaySnap.exists) {
          return;
        }

        const invoiceRef = db.collection('invoices').doc(attempt.invoiceId);
        const invoiceSnap = await transaction.get(invoiceRef);
        if (!invoiceSnap.exists) {
          throw new Error('Invoice not found');
        }
        const invoice = invoiceSnap.data() || {};
        if (invoice.status === 'paid') {
          return;
        }

        const nowIso = new Date().toISOString();
        transaction.set(replayRef, {
          providerTransId,
          attemptId,
          invoiceId: attempt.invoiceId,
          processedAt: nowIso,
        });

        transaction.update(attemptRef, {
          status: 'completed',
          providerTransId,
          completedAt: nowIso,
        });

        transaction.update(invoiceRef, {
          status: 'paid',
          paidAmount: Number(attempt.expectedAmount),
          paidAt: nowIso,
        });

        if (Array.isArray(invoice.chargeIds)) {
          invoice.chargeIds.forEach((chargeId: string) => {
            const chargeRef = db.collection('charges').doc(chargeId);
            transaction.update(chargeRef, { status: 'paid' });
          });
        }

        const trxRef = db.collection('transactions').doc(`trx_cmi_${attemptId}`);
        transaction.set(trxRef, {
          id: trxRef.id,
          buildingId: invoice.buildingId,
          syndicId: invoice.syndicId,
          amount: Number(attempt.expectedAmount),
          type: 'income',
          category: 'fees',
          fundType: 'operating',
          description: `CMI Payment for Invoice #${invoice.invoiceNumber}`,
          date: nowIso,
          paymentMethod: 'cmi',
        });
      });
      res.send('ACTION=POSTAUTH');
    } catch (error) {
      functions.logger.error('Error processing verified CMI callback', error);
      res.status(400).send('FAILURE');
    }
  } else {
    functions.logger.warn(
      `CMI Payment failed for attempt ${attemptId}. Code: ${procReturnCode}`
    );
    res.send('APPROVED');
  }
});

export const createUserForResident = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAuthorizationContext(context);
  const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  const syndicId = typeof data?.syndicId === 'string' ? data.syndicId.trim() : '';
  const buildingId = typeof data?.buildingId === 'string' ? data.buildingId.trim() : '';
  const residentId = typeof data?.residentId === 'string' ? data.residentId.trim() : '';

  if (!email || !syndicId || !buildingId || !residentId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'email, syndicId, buildingId, and residentId are required.'
    );
  }

  // Verify that caller manages this syndic & building (Audit Item 05)
  await assertSyndicOrAdminForBuilding(caller, syndicId, buildingId);

  try {
    let userRecord: admin.auth.UserRecord | null = null;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== 'auth/user-not-found') {
        throw e;
      }
    }

    if (userRecord) {
      // Never silently repurpose an existing user or overwrite unrelated claims (Audit Item 05)
      const existingProfileSnap = await db.collection('users').doc(userRecord.uid).get();
      const existingProfile = existingProfileSnap.data();
      if (
        existingProfile &&
        (existingProfile.role !== 'resident' ||
          (existingProfile.syndicId && existingProfile.syndicId !== syndicId))
      ) {
        throw new functions.https.HttpsError(
          'already-exists',
          'An account with this email already belongs to another role or tenant.'
        );
      }
    } else {
      const randomSecret = crypto.randomBytes(16).toString('hex') + 'Aa1!';
      userRecord = await admin.auth().createUser({
        email,
        emailVerified: false,
        password: randomSecret,
        displayName: name || 'Copropriétaire',
        disabled: false,
      });

      const resetLink = await admin.auth().generatePasswordResetLink(email);
      await sendEmail(
        email,
        'Invitation à votre portail Syndik / ImmoGest',
        `Bonjour ${name},\n\nVotre syndic vous invite à activer votre espace copropriétaire via ce lien sécurisé :\n${resetLink}`
      );
    }

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'resident',
      syndicId,
      buildingId,
      residentId,
    });

    await db
      .collection('users')
      .doc(userRecord.uid)
      .set(
        {
          uid: userRecord.uid,
          email,
          displayName: name || userRecord.displayName || 'Copropriétaire',
          role: 'resident',
          syndicId,
          buildingId,
          residentId,
          mustChangePassword: true,
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );

    return { success: true, uid: userRecord.uid, isNew: true };
  } catch (error: unknown) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unable to provision resident';
    functions.logger.error('Error creating resident user:', error);
    throw new functions.https.HttpsError('internal', message);
  }
});

const generateChargesLogic = async (buildingId?: string, syndicId?: string) => {
  const chargesRef = db.collection('charges');
  const apartmentsRef = db.collection('apartments');

  let aptQuery: admin.firestore.Query = apartmentsRef;
  if (buildingId) {
    aptQuery = aptQuery.where('buildingId', '==', buildingId);
  }
  if (syndicId) {
    aptQuery = aptQuery.where('syndicId', '==', syndicId);
  }

  const apartmentsSnap = await aptQuery.get();
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const periodKey = `${year}-${month}`;
  const currentMonth = now.toLocaleString('fr-FR', { month: 'long' });
  const description = `Syndic Fees - ${currentMonth} ${year}`;
  const dueDate = new Date(year, now.getMonth(), 28).toISOString();

  let createdCount = 0;
  let skippedCount = 0;

  for (const aptDoc of apartmentsSnap.docs) {
    const apt = aptDoc.data();
    const residentId = apt.tenantId || apt.ownerId;
    if (!residentId) continue;

    // Deterministic charge ID prevents duplicate monthly charges across concurrent retries (Audit Item 12)
    const deterministicChargeId = `chg_${apt.buildingId}_${aptDoc.id}_${periodKey}_cotisation`;
    const chargeRef = chargesRef.doc(deterministicChargeId);

    await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(chargeRef);
      if (existingSnap.exists) {
        skippedCount += 1;
        return;
      }
      tx.set(chargeRef, {
        id: deterministicChargeId,
        syndicId: apt.syndicId || syndicId || null,
        buildingId: apt.buildingId,
        apartmentId: aptDoc.id,
        residentId,
        periodKey,
        chargeType: 'courante',
        amount: apt.monthlyFees ?? 0,
        dueDate,
        status: 'unpaid',
        description,
        createdAt: now.toISOString(),
        invoiceId: null,
      });
      createdCount += 1;
    });
  }

  return { success: true, count: createdCount, createdCount, skippedCount, periodKey };
};

export const generateMonthlyCharges = functions
  .runWith({ memory: '512MB', timeoutSeconds: 300 })
  .https.onCall(async (data, context) => {
    const caller = await getCallerAuthorizationContext(context);
    const buildingId = typeof data?.buildingId === 'string' ? data.buildingId.trim() : '';
    const syndicId = typeof data?.syndicId === 'string' ? data.syndicId.trim() : caller.syndicId;

    if (!buildingId) {
      throw new functions.https.HttpsError('invalid-argument', 'buildingId is required.');
    }

    const authTenant = await assertSyndicOrAdminForBuilding(caller, syndicId, buildingId);
    return await generateChargesLogic(buildingId, authTenant.syndicId);
  });

export const scheduledMonthlyCharges = functions
  .runWith({ memory: '1GB', timeoutSeconds: 540 })
  .pubsub.schedule('0 0 1 * *')
  .timeZone('Africa/Casablanca')
  .onRun(async () => {
    return await generateChargesLogic();
  });

export const createInvoice = functions.https.onCall(async (data, context) => {
  const caller = await getCallerAuthorizationContext(context);
  const residentId = typeof data?.residentId === 'string' ? data.residentId.trim() : '';
  const buildingId = typeof data?.buildingId === 'string' ? data.buildingId.trim() : '';
  const syndicId = typeof data?.syndicId === 'string' ? data.syndicId.trim() : '';

  if (!residentId || !buildingId || !syndicId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'residentId, buildingId, and syndicId are required.'
    );
  }

  await assertSyndicOrAdminForBuilding(caller, syndicId, buildingId);

  return await db.runTransaction(async (transaction) => {
    const chargesQuery = db
      .collection('charges')
      .where('syndicId', '==', syndicId)
      .where('buildingId', '==', buildingId)
      .where('residentId', '==', residentId)
      .where('status', 'in', ['unpaid', 'pending', 'overdue'])
      .where('invoiceId', '==', null);

    const chargesSnap = await transaction.get(chargesQuery);

    if (chargesSnap.empty) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'No pending charges found for this resident in the specified building.'
      );
    }

    let totalCentimes = 0;
    const chargeIds: string[] = [];

    chargesSnap.docs.forEach((docSnap) => {
      const charge = docSnap.data();
      totalCentimes += Math.round(Number(charge.amount || 0) * 100);
      chargeIds.push(docSnap.id);
    });

    const totalAmount = totalCentimes / 100;
    const invoiceRef = db.collection('invoices').doc();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

    const newInvoice = {
      id: invoiceRef.id,
      syndicId,
      buildingId,
      residentId,
      invoiceNumber: `INV-${new Date().getFullYear()}-${invoiceRef.id.slice(0, 6).toUpperCase()}`,
      totalAmount,
      paidAmount: 0,
      status: 'unpaid',
      createdAt: new Date().toISOString(),
      dueDate: dueDate.toISOString(),
      chargeIds,
      pdfUrl: null,
    };

    transaction.set(invoiceRef, newInvoice);

    chargesSnap.docs.forEach((docSnap) => {
      transaction.update(docSnap.ref, { invoiceId: invoiceRef.id });
    });

    return { success: true, invoiceId: invoiceRef.id };
  });
});

export const checkOverdueInvoices = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const now = new Date().toISOString();
    const invoicesRef = db.collection('invoices');

    const overdueSnap = await invoicesRef
      .where('status', '==', 'unpaid')
      .where('dueDate', '<', now)
      .get();

    if (overdueSnap.empty) {
      return null;
    }

    const chunks = chunkArray(overdueSnap.docs, 400);

    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((docSnap) => {
        batch.update(docSnap.ref, { status: 'overdue' });
      });
      await batch.commit();
    }
    return null;
  });

export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const userRef = db.collection('users').doc(user.uid);
  const docSnap = await userRef.get();

  if (!docSnap.exists) {
    await userRef.set({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || 'New User',
      role: 'resident',
      photoURL: user.photoURL || null,
      createdAt: new Date().toISOString(),
    });
  } else {
    const userData = docSnap.data();
    if (userData?.role === 'syndic') {
      const syndicRef = db.collection('syndics').doc(user.uid);
      const syndicSnap = await syndicRef.get();
      if (!syndicSnap.exists) {
        const trialExpires = new Date(Date.now() + 30 * 86400000).toISOString();

        await syndicRef.set({
          id: user.uid,
          name: userData.displayName || 'Cabinet Syndic',
          email: user.email || userData.email || '',
          logoUrl: userData.photoURL || '',
          createdBy: user.uid,
          subscriptionPlan: 'starter',
          subscriptionStatus: 'active',
          subscriptionExpiry: trialExpires,
          buildings: [],
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
});

export const onInvoiceCreated = functions.firestore
  .database(FIRESTORE_DATABASE_ID)
  .document('invoices/{invoiceId}')
  .onCreate(async (snap) => {
    const invoice = snap.data();
    const residentId = invoice.residentId;

    const userSnap = await db
      .collection('users')
      .where('residentId', '==', residentId)
      .limit(1)
      .get();

    if (userSnap.empty) return;

    const user = userSnap.docs[0].data();
    const title = 'New Invoice';
    const message = `A new invoice ${invoice.invoiceNumber} for ${invoice.totalAmount} MAD has been generated.`;

    await createNotification(user.uid, title, message, 'invoice');
    if (user.email) {
      await sendEmail(user.email, title, message);
    }
  });

export const onMaintenanceUpdated = functions.firestore
  .database(FIRESTORE_DATABASE_ID)
  .document('maintenance/{requestId}')
  .onUpdate(async (change) => {
    const newData = change.after.data();
    const previousData = change.before.data();

    if (newData.status === previousData.status) return;

    const residentId = newData.residentId;
    const userSnap = await db
      .collection('users')
      .where('residentId', '==', residentId)
      .limit(1)
      .get();

    if (!userSnap.empty) {
      const user = userSnap.docs[0].data();
      const title = 'Maintenance Update';
      const message = `Your request regarding '${newData.category}' is now ${newData.status}.`;

      await createNotification(user.uid, title, message, 'maintenance');
      if (user.email) {
        await sendEmail(user.email, title, message);
      }
    }
  });

export const onAnnouncementCreated = functions.firestore
  .database(FIRESTORE_DATABASE_ID)
  .document('buildings/{buildingId}/announcements/{announcementId}')
  .onCreate(async (snap, context) => {
    const buildingId = context.params.buildingId;
    const announcement = snap.data();

    const usersSnap = await db
      .collection('users')
      .where('buildingId', '==', buildingId)
      .get();

    if (usersSnap.empty) return;

    const title = 'New Announcement';
    const message = `New announcement: ${announcement.title}`;

    const batch = db.batch();
    const promises: Promise<void>[] = [];

    usersSnap.docs.forEach((docSnap) => {
      const user = docSnap.data();
      const notifRef = db.collection('notifications').doc();
      batch.set(notifRef, {
        userId: user.uid,
        title,
        message,
        type: 'announcement',
        read: false,
        createdAt: new Date().toISOString(),
      });

      if (user.email) {
        promises.push(sendEmail(user.email, title, message));
      }
    });

    await batch.commit();
    await Promise.all(promises);
  });
