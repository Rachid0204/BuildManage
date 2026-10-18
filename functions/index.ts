
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

admin.initializeApp();
const db = admin.firestore();

// --- CMI Configuration ---
const CMI_CONFIG = {
    clientId: "600000001",
    storeKey: "MOCK_STORE_KEY",
    gatewayUrl: "https://testpayment.cmi.co.ma/fim/est3Dgate",
    currency: "504", // MAD
    lang: "fr",
    storetype: "3d_pay_hosting"
};

// Utility to chunk arrays for Batch Writes
const chunkArray = <T>(array: T[], size: number): T[][] => {
    const chunked: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};

/**
 * Helper to send email using native fetch (Node 18+)
 */
const sendEmail = async (to: string, subject: string, body: string) => {
    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    
    if (!SENDGRID_API_KEY) {
        functions.logger.info(`[EMAIL SIMULATION] API Key missing. To: ${to}, Subject: ${subject}`);
        return;
    }

    try {
        // @ts-ignore - fetch is global in Node 18 environment provided by Firebase Functions
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SENDGRID_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: to }] }],
                from: { email: 'noreply@syndik.ma', name: 'Syndic App' },
                subject: subject,
                content: [{ type: 'text/plain', value: body }]
            })
        });

        if (!response.ok) {
            // @ts-ignore
            const errorData = await response.json();
            functions.logger.error('Error sending email', errorData);
        } else {
            functions.logger.info(`Email sent to ${to}`);
        }
    } catch (error: any) {
        functions.logger.error('Network error sending email', error.message);
    }
};

/**
 * Helper to create in-app notification
 */
const createNotification = async (userId: string, title: string, message: string, type: string) => {
    await db.collection('notifications').add({
        userId,
        title,
        message,
        type,
        read: false,
        createdAt: new Date().toISOString()
    });
};

// --- CMI Helper Functions ---

const calculateCmiHash = (params: Record<string, string>, storeKey: string): string => {
    const sortedKeys = Object.keys(params).sort();
    let rawString = "";
    sortedKeys.forEach(key => {
        rawString += params[key].trim();
    });
    rawString += storeKey;
    return crypto.createHash('sha512').update(rawString).digest('base64');
};

export const generateCmiPaymentData = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { invoiceId, returnUrl } = data;
    
    const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
    if (!invoiceDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Invoice not found.');
    }
    const invoice = invoiceDoc.data();
    
    if (invoice?.status === 'paid') {
        throw new functions.https.HttpsError('failed-precondition', 'Invoice already paid.');
    }

    const amount = invoice?.totalAmount.toFixed(2);
    const oid = invoiceId;
    
    const params: Record<string, string> = {
        clientid: CMI_CONFIG.clientId,
        amount: amount,
        okUrl: returnUrl,
        failUrl: returnUrl,
        TranType: "0",
        callbackUrl: `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/cmiCallback`,
        shopurl: returnUrl,
        currency: CMI_CONFIG.currency,
        rnd: Date.now().toString(),
        storetype: CMI_CONFIG.storetype,
        oid: oid,
        lang: CMI_CONFIG.lang,
        email: context.auth.token.email || "",
        BillToName: context.auth.token.name || "Resident",
    };

    const hash = calculateCmiHash(params, CMI_CONFIG.storeKey);
    params.hash = hash;
    params.hashAlgorithm = "ver3";

    return { 
        action: CMI_CONFIG.gatewayUrl,
        params: params 
    };
});

export const cmiCallback = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const data = req.body;
    const invoiceId = data.oid;
    const procReturnCode = data.ProcReturnCode; 

    if (procReturnCode === "00") {
        try {
            await db.runTransaction(async (transaction) => {
                const invoiceRef = db.collection('invoices').doc(invoiceId);
                const invoiceSnap = await transaction.get(invoiceRef);
                
                if (!invoiceSnap.exists) return;
                const invoice = invoiceSnap.data();

                if (invoice?.status === 'paid') return;

                transaction.update(invoiceRef, { status: 'paid' });

                if (invoice?.chargeIds) {
                    invoice.chargeIds.forEach((chargeId: string) => {
                        const chargeRef = db.collection('charges').doc(chargeId);
                        transaction.update(chargeRef, { status: 'paid' });
                    });
                }

                const trxRef = db.collection('transactions').doc();
                transaction.set(trxRef, {
                    buildingId: invoice?.buildingId,
                    amount: invoice?.totalAmount,
                    type: 'income',
                    category: 'fees',
                    description: `CMI Payment for Invoice #${invoice?.invoiceNumber}`,
                    date: new Date().toISOString(),
                    method: 'cmi'
                });
            });
            res.send("ACTION=POSTAUTH");
        } catch (error) {
            console.error("Error processing CMI callback", error);
            res.status(500).send("Error");
        }
    } else {
        functions.logger.warn(`CMI Payment failed for OID ${invoiceId}. Code: ${procReturnCode}`);
        res.send("APPROVED");
    }
});

export const createUserForResident = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }
    
    const { email, name, role, syndicId, buildingId, residentId } = data;

    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'Email is required.');
    }

    try {
        let userRecord;
        try {
            userRecord = await admin.auth().getUserByEmail(email);
        } catch (e: any) {
            if (e.code === 'auth/user-not-found') {
                const tempPassword = Math.random().toString(36).slice(-8) + "Aa1!";
                userRecord = await admin.auth().createUser({
                    email,
                    emailVerified: false,
                    password: tempPassword,
                    displayName: name,
                    disabled: false
                });
                
                await sendEmail(email, "Welcome to Syndik", `Your temporary password is: ${tempPassword}`);
            } else {
                throw e;
            }
        }

        await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'resident' });

        await db.collection('users').doc(userRecord.uid).set({
            uid: userRecord.uid,
            email: email,
            displayName: name,
            role: 'resident',
            syndicId,
            buildingId,
            residentId, 
            createdAt: new Date().toISOString()
        }, { merge: true });

        return { success: true, uid: userRecord.uid, isNew: true };

    } catch (error: any) {
        functions.logger.error("Error creating resident user:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

const generateChargesLogic = async (buildingId?: string) => {
    const chargesRef = db.collection('charges');
    const apartmentsRef = db.collection('apartments');
    
    let query = apartmentsRef as admin.firestore.Query;
    if (buildingId) {
        query = query.where('buildingId', '==', buildingId);
    }

    const apartmentsSnap = await query.get();
    const now = new Date();
    const currentMonth = now.toLocaleString('default', { month: 'long' });
    const currentYear = now.getFullYear();
    const description = `Syndic Fees - ${currentMonth} ${currentYear}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const newCharges: any[] = [];

    for (const doc of apartmentsSnap.docs) {
        const apt = doc.data();
        const residentId = apt.tenantId || apt.ownerId;
        
        if (residentId) {
             const existingCheck = await chargesRef
                .where('apartmentId', '==', doc.id)
                .where('description', '==', description)
                .limit(1)
                .get();

             if (existingCheck.empty) {
                 newCharges.push({
                    buildingId: apt.buildingId,
                    apartmentId: doc.id,
                    residentId: residentId,
                    amount: apt.monthlyFees || 0,
                    dueDate: dueDate.toISOString(),
                    status: 'pending',
                    description: description,
                    createdAt: now.toISOString(),
                    invoiceId: null
                });
             }
        }
    }

    const chunks = chunkArray(newCharges, 400); 
    let totalCreated = 0;

    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach(charge => {
            const ref = chargesRef.doc();
            batch.set(ref, charge);
        });
        await batch.commit();
        totalCreated += chunk.length;
    }

    return { success: true, count: totalCreated };
};

export const generateMonthlyCharges = functions
    .runWith({ memory: '512MB', timeoutSeconds: 300 })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
        }
        return await generateChargesLogic(data.buildingId);
    });

export const scheduledMonthlyCharges = functions
    .runWith({ memory: '1GB', timeoutSeconds: 540 })
    .pubsub.schedule('0 0 1 * *')
    .timeZone('Africa/Casablanca')
    .onRun(async (context) => {
        return await generateChargesLogic(); 
    });

export const createInvoice = functions.https.onCall(async (data, context) => {
    const { residentId, buildingId, syndicId } = data;

    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    return await db.runTransaction(async (transaction) => {
        const chargesQuery = db.collection('charges')
            .where('residentId', '==', residentId)
            .where('status', '==', 'pending')
            .where('invoiceId', '==', null);
        
        const chargesSnap = await transaction.get(chargesQuery);

        if (chargesSnap.empty) {
            throw new functions.https.HttpsError('failed-precondition', 'No pending charges found.');
        }

        let totalAmount = 0;
        const chargeIds: string[] = [];

        chargesSnap.docs.forEach(doc => {
            const charge = doc.data();
            totalAmount += charge.amount;
            chargeIds.push(doc.id);
        });

        const invoiceRef = db.collection('invoices').doc();
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);

        const newInvoice = {
            id: invoiceRef.id,
            syndicId,
            buildingId,
            residentId,
            invoiceNumber: `INV-${Date.now()}`,
            totalAmount,
            status: 'unpaid',
            createdAt: new Date().toISOString(),
            dueDate: dueDate.toISOString(),
            chargeIds,
            pdfUrl: null 
        };

        transaction.set(invoiceRef, newInvoice);

        chargesSnap.docs.forEach(doc => {
            transaction.update(doc.ref, { invoiceId: invoiceRef.id });
        });

        return { success: true, invoiceId: invoiceRef.id };
    });
});

export const checkOverdueInvoices = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
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
        let count = 0;

        for (const chunk of chunks) {
            const batch = db.batch();
            chunk.forEach((doc: any) => {
                batch.update(doc.ref, { status: 'overdue' });
            });
            await batch.commit();
            count += chunk.length;
        }
        return null;
    });

export const onUserCreate = functions.auth.user().onCreate(async (user) => {
    const userRef = db.collection('users').doc(user.uid);
    const docSnap = await userRef.get();
    
    if (!docSnap.exists) {
        await userRef.set({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || 'New User',
            role: 'resident',
            photoURL: user.photoURL,
            createdAt: new Date().toISOString()
        });
    } else {
        const userData = docSnap.data();
        if (userData?.role === 'syndic') {
            const syndicRef = db.collection('syndics').doc(user.uid);
            const syndicSnap = await syndicRef.get();
            if (!syndicSnap.exists) {
                const trialExpires = new Date();
                trialExpires.setDate(trialExpires.getDate() + 30);

                await syndicRef.set({
                    id: user.uid,
                    name: userData.displayName || 'My Syndic Company',
                    logoUrl: userData.photoURL || 'https://via.placeholder.com/150',
                    createdBy: user.uid,
                    subscriptionPlan: 'starter',
                    subscriptionStatus: 'active',
                    subscriptionExpiry: trialExpires.toISOString(),
                    createdAt: new Date().toISOString()
                });
            }
        }
    }
});

export const onInvoiceCreated = functions.firestore
    .document('invoices/{invoiceId}')
    .onCreate(async (snap, context) => {
        const invoice = snap.data();
        const residentId = invoice.residentId;

        const userSnap = await db.collection('users')
            .where('residentId', '==', residentId)
            .limit(1)
            .get();

        if (userSnap.empty) return;

        const user = userSnap.docs[0].data();
        const title = "New Invoice";
        const message = `A new invoice ${invoice.invoiceNumber} for ${invoice.totalAmount} MAD has been generated.`;

        await createNotification(user.uid, title, message, 'invoice');
        if (user.email) {
            await sendEmail(user.email, title, message);
        }
    });

export const onMaintenanceUpdated = functions.firestore
    .document('maintenance/{requestId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();

        if (newData.status === previousData.status) return;

        const residentId = newData.residentId;
        const userSnap = await db.collection('users')
            .where('residentId', '==', residentId)
            .limit(1)
            .get();

        if (!userSnap.empty) {
            const user = userSnap.docs[0].data();
            const title = "Maintenance Update";
            const message = `Your request regarding '${newData.category}' is now ${newData.status}.`;
            
            await createNotification(user.uid, title, message, 'maintenance');
            if (user.email) {
                await sendEmail(user.email, title, message);
            }
        }
    });

export const onAnnouncementCreated = functions.firestore
    .document('buildings/{buildingId}/announcements/{announcementId}')
    .onCreate(async (snap, context) => {
        const buildingId = context.params.buildingId;
        const announcement = snap.data();

        const usersSnap = await db.collection('users')
            .where('buildingId', '==', buildingId)
            .get();

        if (usersSnap.empty) return;

        const title = "New Announcement";
        const message = `New announcement: ${announcement.title}`;

        const batch = db.batch();
        const promises: Promise<any>[] = [];

        usersSnap.docs.forEach(doc => {
            const user = doc.data();
            const notifRef = db.collection('notifications').doc();
            batch.set(notifRef, {
                userId: user.uid,
                title,
                message,
                type: 'announcement',
                read: false,
                createdAt: new Date().toISOString()
            });

            if (user.email) {
                promises.push(sendEmail(user.email, title, message));
            }
        });

        await batch.commit();
        await Promise.all(promises);
    });
