// Budget — qui a le droit d'ouvrir l'app.
// Pas de mot de passe : chaque téléphone est activé une fois (code d'installation
// ou invitation), puis reste reconnu grâce à un cookie valable 400 jours,
// prolongé à chaque utilisation.

import { empreinte } from './banque.js';

const COOKIE = 'budget';
const DUREE_COOKIE = 400 * 86400;         // maximum accepté par les navigateurs
const DUREE_INVITATION = 48 * 3600000;
const ACTIVATIONS_PAR_INVITATION = 3;     // Safari puis l'app installée, plus une marge
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I

const maintenant = () => new Date().toISOString();

function aleatoire(n) {
  const o = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function codeLisible() {
  const o = crypto.getRandomValues(new Uint8Array(10));
  const c = [...o].map((x) => ALPHABET[x % 32]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

// Tolère les espaces, minuscules et tirets oubliés.
export function normaliserCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function egal(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

function lireCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export function cookieSession(jeton, req) {
  const securise = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${jeton}; Path=/; Max-Age=${DUREE_COOKIE}; HttpOnly; SameSite=Lax${securise}`;
}
export function cookieEfface(req) {
  const securise = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${securise}`;
}

// Renvoie { appareil, cookie? } ; cookie est à renvoyer pour prolonger la session.
export async function appareilCourant(req, env) {
  const jeton = lireCookie(req);
  if (!jeton) return null;
  const a = await env.DB.prepare('SELECT id, nom, admin, vu FROM appareils WHERE jeton = ?').bind(await empreinte(jeton)).first();
  if (!a) return null;
  let cookie = null;
  if (Date.now() - Date.parse(a.vu) > 86400000) {
    await env.DB.prepare('UPDATE appareils SET vu = ? WHERE id = ?').bind(maintenant(), a.id).run();
    cookie = cookieSession(jeton, req);
  }
  return { appareil: { id: a.id, nom: a.nom, admin: !!a.admin }, cookie };
}

// Freine les essais de codes au hasard : 20 échecs par heure au maximum, tous téléphones confondus.
async function trop(env) {
  const r = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'echecs'").first();
  const e = r ? JSON.parse(r.valeur) : { debut: 0, n: 0 };
  return Date.now() - e.debut < 3600000 && e.n >= 20;
}
async function noterEchec(env) {
  const r = await env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'echecs'").first();
  let e = r ? JSON.parse(r.valeur) : { debut: 0, n: 0 };
  if (Date.now() - e.debut >= 3600000) e = { debut: Date.now(), n: 0 };
  e.n++;
  await env.DB.prepare("INSERT INTO reglages (cle, valeur) VALUES ('echecs', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").bind(JSON.stringify(e)).run();
}

// Active ce téléphone avec le code d'installation (administrateur) ou un code d'invitation.
export async function activer(env, code, nomPropose) {
  if (await trop(env)) return { erreur: 'Trop d’essais. Réessaie dans une heure.' };
  const brut = String(code || '').trim();
  let nom, admin;
  // Majuscules, minuscules et espaces en trop ne comptent pas (claviers de téléphone).
  const simplifier = (t) => String(t).trim().replace(/\s+/g, ' ').toLowerCase();
  if (env.CODE_INSTALLATION && brut && egal(simplifier(brut), simplifier(env.CODE_INSTALLATION))) {
    nom = String(nomPropose || '').trim().slice(0, 40) || 'Administrateur';
    admin = 1;
  } else {
    const h = await empreinte(normaliserCode(brut));
    const inv = await env.DB.prepare('UPDATE invitations SET restant = restant - 1 WHERE code = ? AND restant > 0 AND expire > ? RETURNING nom')
      .bind(h, maintenant()).first();
    if (!inv) {
      await noterEchec(env);
      // Aide au premier lancement : signaler un secret absent plutôt qu'un « code inconnu ».
      if (!env.CODE_INSTALLATION && !(await env.DB.prepare('SELECT 1 FROM appareils WHERE admin = 1 LIMIT 1').first())) {
        return { erreur: 'Le secret CODE_INSTALLATION est absent du serveur (Cloudflare > Worker budget > Settings > Variables and Secrets).' };
      }
      return { erreur: 'Code inconnu ou expiré. Demande une nouvelle invitation.' };
    }
    nom = inv.nom;
    admin = 0;
  }
  const jeton = aleatoire(32);
  const id = aleatoire(9);
  await env.DB.prepare('INSERT INTO appareils (id, nom, jeton, admin, cree, vu) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, nom, await empreinte(jeton), admin, maintenant(), maintenant()).run();
  return { jeton, appareil: { id, nom, admin: !!admin } };
}

export async function creerInvitation(env, nom) {
  const code = codeLisible();
  const expire = new Date(Date.now() + DUREE_INVITATION).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invitations WHERE expire < ? OR restant <= 0').bind(maintenant()),
    env.DB.prepare('INSERT INTO invitations (code, nom, expire, restant) VALUES (?, ?, ?, ?)')
      .bind(await empreinte(normaliserCode(code)), nom, expire, ACTIVATIONS_PAR_INVITATION),
  ]);
  return { code, expire };
}
