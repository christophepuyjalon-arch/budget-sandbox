// Budget — dialogue avec Enable Banking (accès aux comptes bancaires, norme DSP2).
// Chaque appel est signé par un jeton JWT fabriqué avec ta clé privée (secret EB_PRIVATE_KEY).

const API = 'https://api.enablebanking.com'; // EB_API (dans .dev.vars) permet de viser un faux serveur pour les tests
const JOUR = 86400000;

export class ErreurBanque extends Error {
  constructor(message, statut, code) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
  // L'autorisation donnée à la banque n'est plus valable : il faut la renouveler.
  get autorisationPerdue() {
    return this.statut === 401 || this.statut === 403 || /EXPIRED|CLOSED|REVOKED|INVALID_SESSION|SESSION/i.test(this.code || '');
  }
}

// ---------- signature des appels ----------

let cleCache = null;

// Accepte la clé telle qu'exportée par le site Enable Banking (« BEGIN PRIVATE KEY »),
// mais aussi l'ancien format RSA (« BEGIN RSA PRIVATE KEY ») et les copier-coller abîmés
// (retours à la ligne perdus ou écrits « \n »).
async function clePrivee(env) {
  if (cleCache?.source === env.EB_PRIVATE_KEY) return cleCache.cle;
  const texte = String(env.EB_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!/PRIVATE KEY/.test(texte)) throw new ErreurBanque('Clé privée Enable Banking absente (secret EB_PRIVATE_KEY).', 0, 'CONFIG');
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(texte);
  const b64 = texte.replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  let der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (pkcs1) der = enveloppePkcs8(der);
  const cle = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  cleCache = { source: env.EB_PRIVATE_KEY, cle };
  return cle;
}

// PKCS#1 → PKCS#8 : SEQUENCE { 0, SEQUENCE { rsaEncryption, NULL }, OCTET STRING { clé } }
function enveloppePkcs8(pkcs1) {
  const longueur = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
  const tlv = (tag, contenu) => [tag, ...longueur(contenu.length), ...contenu];
  const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return new Uint8Array(tlv(0x30, [0x02, 0x01, 0x00, ...algo, ...tlv(0x04, [...pkcs1])]));
}

const b64url = (octets) => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlTexte = (s) => b64url(new TextEncoder().encode(s));

// Le jeton est réutilisé pendant 50 minutes : la signature RSA coûte du temps de calcul.
let jetonCache = null;

export async function jeton(env) {
  if (!env.EB_APP_ID) throw new ErreurBanque('Identifiant EB_APP_ID absent de wrangler.toml.', 0, 'CONFIG');
  const maintenant = Math.floor(Date.now() / 1000);
  if (jetonCache && jetonCache.app === env.EB_APP_ID && jetonCache.cle === env.EB_PRIVATE_KEY && jetonCache.fin > maintenant) return jetonCache.valeur;
  const valeur = await signer(env, maintenant);
  jetonCache = { app: env.EB_APP_ID, cle: env.EB_PRIVATE_KEY, fin: maintenant + 3000, valeur };
  return valeur;
}

async function signer(env, maintenant) {
  const entete = b64urlTexte(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: env.EB_APP_ID }));
  const charge = b64urlTexte(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: maintenant, exp: maintenant + 3600 }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await clePrivee(env), new TextEncoder().encode(`${entete}.${charge}`));
  return `${entete}.${charge}.${b64url(signature)}`;
}

// psu : { ip, agent } quand tu es devant l'app. La banque ne décompte alors pas
// la consultation de son quota quotidien (4 consultations par jour sans toi).
async function appel(env, methode, chemin, corps, psu) {
  const entetes = { authorization: `Bearer ${await jeton(env)}`, accept: 'application/json' };
  if (corps) entetes['content-type'] = 'application/json';
  if (psu?.ip) entetes['psu-ip-address'] = psu.ip;
  if (psu?.agent) entetes['psu-user-agent'] = psu.agent;
  const r = await fetch((env.EB_API || API) + chemin, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined });
  const texte = await r.text();
  let donnees = null;
  try { donnees = texte ? JSON.parse(texte) : null; } catch { /* réponse non JSON */ }
  if (!r.ok) {
    const detail = donnees?.message || donnees?.detail || donnees?.error || texte.slice(0, 200) || r.statusText;
    console.log(`Enable Banking ${methode} ${chemin} → ${r.status}`, texte.slice(0, 500));
    throw new ErreurBanque(`${r.status} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, r.status, donnees?.code || donnees?.error);
  }
  return donnees;
}

// ---------- banques et autorisation ----------

export async function listerBanques(env, pays) {
  const r = await appel(env, 'GET', `/aspsps?country=${encodeURIComponent(pays)}&psu_type=personal`);
  return (r?.aspsps || [])
    .filter((a) => !a.psu_types || a.psu_types.includes('personal'))
    .map((a) => ({ nom: a.name, pays: a.country, duree: a.maximum_consent_validity || null, logo: a.logo || null }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

// Renvoie l'adresse de la banque où tu donnes ton accord.
export async function demarrerAutorisation(env, banque, adresseRetour, etat) {
  const duree = Math.min(banque.duree || 90 * 86400, 180 * 86400) * 1000;
  const fin = new Date(Date.now() + duree - JOUR).toISOString();
  const r = await appel(env, 'POST', '/auth', {
    access: { valid_until: fin },
    aspsp: { name: banque.nom, country: banque.pays },
    state: etat,
    redirect_url: adresseRetour,
    psu_type: 'personal',
  });
  if (!r?.url) throw new ErreurBanque('Enable Banking n’a pas renvoyé d’adresse de connexion.', 0, 'REPONSE');
  return r.url;
}

// Après ton accord chez la banque : crée la session et liste les comptes.
export async function finaliserAutorisation(env, code) {
  const s = await appel(env, 'POST', '/sessions', { code });
  const comptes = (s?.accounts || []).map((a) => (typeof a === 'string' ? { uid: a } : a)).map((a) => ({
    uid: a.uid,
    id: idStable(a),
    nom: a.name || a.details || a.product || a.account_id?.iban || 'Compte',
    iban: a.account_id?.iban || null,
    devise: a.currency || 'EUR',
  })).filter((a) => a.uid);
  return {
    id: s.session_id,
    banque: s.aspsp?.name || '',
    pays: s.aspsp?.country || '',
    expire: s.access?.valid_until || null,
    comptes,
  };
}

function idStable(a) {
  return a.identification_hash || a.account_id?.iban || a.uid;
}

export async function supprimerSession(env, id) {
  try { await appel(env, 'DELETE', `/sessions/${encodeURIComponent(id)}`); } catch (e) { console.log('suppression session', e.message); }
}

// ---------- soldes et opérations ----------

// Ordre de préférence : solde comptabilisé le plus récent d'abord.
const TYPES_SOLDE = ['CLBD', 'ITBD', 'XPCD', 'ITAV', 'CLAV', 'OPBD', 'PRCD', 'OTHR'];

export async function lireSolde(env, uid, psu) {
  const r = await appel(env, 'GET', `/accounts/${encodeURIComponent(uid)}/balances`, null, psu);
  const soldes = r?.balances || [];
  if (!soldes.length) return null;
  soldes.sort((a, b) => rang(a.balance_type) - rang(b.balance_type));
  const s = soldes[0];
  return {
    montant: enCentimes(s.balance_amount?.amount),
    type: s.balance_type || null,
    date: s.reference_date || s.last_change_date_time || null,
  };
}
const rang = (t) => { const i = TYPES_SOLDE.indexOf(t); return i < 0 ? 99 : i; };

export async function lireOperations(env, uid, depuis, psu) {
  const toutes = [];
  let suite = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ date_from: depuis });
    if (suite) q.set('continuation_key', suite);
    const r = await appel(env, 'GET', `/accounts/${encodeURIComponent(uid)}/transactions?${q}`, null, psu);
    toutes.push(...(r?.transactions || []));
    suite = r?.continuation_key;
    if (!suite) break;
  }
  return toutes;
}

export function enCentimes(montant) {
  const n = Number.parseFloat(String(montant ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Transforme une opération Enable Banking en ligne pour la base.
// Les opérations sans identifiant reçoivent une empreinte (date, montant, libellé, rang).
export async function convertir(compteId, liste) {
  const vus = new Map();
  const sortie = [];
  for (const t of liste) {
    let montant = Math.abs(enCentimes(t.transaction_amount?.amount));
    if (t.credit_debit_indicator === 'DBIT') montant = -montant;
    else if (!t.credit_debit_indicator && enCentimes(t.transaction_amount?.amount) < 0) montant = -montant;
    const date = (t.booking_date || t.value_date || t.transaction_date || '').slice(0, 10);
    if (!date) continue;
    const brutTexte = [].concat(t.remittance_information || []).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const { texte: infos, carte } = nettoyerLibelle(brutTexte);
    const contrepartie = (montant < 0 ? t.creditor?.name : t.debtor?.name) || t.creditor?.name || t.debtor?.name || null;
    const libelle = infos || contrepartie || t.bank_transaction_code?.description || 'Opération';
    // PDNG : en cours. AVNR : paiement carte à débit différé, pas encore débité du compte
    // (la Caisse d'Épargne l'envoie en « OTHR », sans date de comptabilisation).
    const statut = t.status === 'PDNG' ? 'PDNG' : t.status === 'OTHR' && !t.booking_date ? 'AVNR' : 'BOOK';
    let ref = t.entry_reference || t.transaction_id;
    if (!ref) {
      const base = `${statut}|${date}|${montant}|${libelle}`;
      const n = (vus.get(base) || 0) + 1;
      vus.set(base, n);
      ref = 'h' + (await empreinte(`${base}|${n}`)).slice(0, 24);
    }
    sortie.push({ id: `${compteId}:${ref}`, date, montant, libelle, contrepartie, statut, carte, brut: JSON.stringify(t) });
  }
  return sortie;
}

// « SPEEDY000000296   342031******5 » → { texte: 'SPEEDY', carte: '5' }
// Le numéro de carte masqué permet de savoir quelle carte a payé.
export function nettoyerLibelle(texte) {
  let carte = null;
  let t = String(texte || '').replace(/\b\d{4,6}\*{3,}(\d{1,4})\b/, (_, fin) => { carte = fin; return ' '; });
  t = t.replace(/([A-Za-z.])\d{5,}\b/g, '$1 ')   // codes collés au nom du commerçant
    .replace(/\s+/g, ' ').trim();
  return { texte: t, carte };
}

export async function empreinte(texte) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((o) => o.toString(16).padStart(2, '0')).join('');
}
