// Budget — serveur personnel (Cloudflare Worker)
// Rôle : récupérer tes opérations bancaires via Enable Banking, les stocker (base D1)
// et les servir aux téléphones de la famille.

import {
  ErreurBanque, listerBanques, demarrerAutorisation, finaliserAutorisation, supprimerSession,
  lireSolde, lireOperations, convertir,
} from './banque.js';
import { appareilCourant, activer, creerInvitation, cookieSession, cookieEfface } from './acces.js';
import { preparerBase } from './schema.js';

const JOUR = 86400000;
const HISTORIQUE_INITIAL = 365;  // jours importés à la première connexion (la banque peut en donner moins)
const RECOUVREMENT = 10;         // jours relus à chaque synchro (opérations en cours devenues définitives)
const PAUSE_SYNCHRO = 60000;     // délai minimum entre deux synchros manuelles

const maintenant = () => new Date().toISOString();
const jourISO = (t) => new Date(t).toISOString().slice(0, 10);
const suivant = (m) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); };
const precedent = (m) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

export default {
  async fetch(req, env) {
    try {
      await preparerBase(env);
      return await router(req, env);
    } catch (e) {
      console.log('erreur', e.stack || e.message);
      return json({ erreur: e instanceof ErreurBanque ? `Banque : ${e.message}` : 'Erreur interne du serveur.' }, 500);
    }
  },
  async scheduled(_evt, env, ctx) {
    ctx.waitUntil(preparerBase(env).then(() => synchroniser(env, null)));
  },
};

// ---------- utilitaires ----------
function json(obj, status = 200, cookie = null) {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (cookie) h['set-cookie'] = cookie;
  return new Response(JSON.stringify(obj), { status, headers: h });
}

function redirection(url, cookie = null) {
  const h = { location: url, 'cache-control': 'no-store' };
  if (cookie) h['set-cookie'] = cookie;
  return new Response(null, { status: 302, headers: h });
}

async function lireReglage(env, cle) {
  const r = await env.DB.prepare('SELECT valeur FROM reglages WHERE cle = ?').bind(cle).first();
  return r ? JSON.parse(r.valeur) : null;
}
function ecrireReglage(env, cle, valeur) {
  return env.DB.prepare('INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur')
    .bind(cle, JSON.stringify(valeur));
}

// Majuscules sans accents ni espaces multiples : la forme des libellés bancaires.
export function normaliser(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Un paiement carte « à débiter » (AVNR) réapparaît comptabilisé (BOOK) le jour du débit,
// peut-être avec un autre identifiant. Même carte, même montant, même date d'achat : c'est le même.
// On garde la version comptabilisée, en lui reportant le classement fait à la main.
async function fusionnerPaiementsCarte(env) {
  const memes = `FROM operations a WHERE a.statut = 'AVNR' AND a.carte IS NOT NULL AND a.compte = b.compte
    AND a.carte = b.carte AND a.montant = b.montant AND a.date = b.date`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE operations AS b SET
        categorie = COALESCE(b.categorie, (SELECT a.categorie ${memes} LIMIT 1)),
        projet = COALESCE(b.projet, (SELECT a.projet ${memes} LIMIT 1))
      WHERE b.statut = 'BOOK' AND b.carte IS NOT NULL AND EXISTS (SELECT 1 ${memes})`),
    env.DB.prepare(`DELETE FROM operations WHERE statut = 'AVNR' AND carte IS NOT NULL AND EXISTS (
      SELECT 1 FROM operations b WHERE b.statut = 'BOOK' AND b.compte = operations.compte AND b.carte = operations.carte
        AND b.montant = operations.montant AND b.date = operations.date)`),
  ]);
}

// Rattache aux projets qui ont un motif les opérations de leur période (sauf celles retirées à la main).
async function rattacherProjets(env) {
  await env.DB.prepare(`UPDATE operations SET projet = (
      SELECT p.id FROM projets p
      WHERE p.motif IS NOT NULL AND p.archive = 0
        AND operations.date >= p.debut || '-01' AND operations.date <= p.fin || '-31'
        AND (instr(upper(operations.libelle), p.motif) > 0 OR instr(upper(coalesce(operations.contrepartie, '')), p.motif) > 0)
      ORDER BY length(p.motif) DESC LIMIT 1)
    WHERE projet IS NULL AND EXISTS (
      SELECT 1 FROM projets p WHERE p.motif IS NOT NULL AND p.archive = 0
        AND operations.date >= p.debut || '-01' AND operations.date <= p.fin || '-31'
        AND (instr(upper(operations.libelle), p.motif) > 0 OR instr(upper(coalesce(operations.contrepartie, '')), p.motif) > 0))`).run();
}

const psuDe = (req) => ({ ip: req.headers.get('cf-connecting-ip') || '', agent: req.headers.get('user-agent') || '' });

// ---------- routes ----------
async function router(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;

  // Lien d'invitation : on sert l'app, qui lit le code dans l'adresse.
  if (p.startsWith('/i/')) return env.ASSETS.fetch(new Request(new URL('/', url), req));

  // Protection contre les formulaires piégés venant d'autres sites.
  if (req.method !== 'GET') {
    const origine = req.headers.get('origin');
    if (origine && origine !== url.origin) return json({ erreur: 'Origine refusée.' }, 403);
  }

  if (p === '/api/activer' && req.method === 'POST') {
    const { code, nom } = await req.json().catch(() => ({}));
    const r = await activer(env, code, nom);
    if (r.erreur) return json({ erreur: r.erreur }, 401);
    return json({ moi: r.appareil }, 200, cookieSession(r.jeton, req));
  }

  const session = await appareilCourant(req, env);
  if (!session) {
    if (p === '/callback') return redirection('/');
    return json({ erreur: 'Ce téléphone n’est pas activé.' }, 401);
  }
  const moi = session.appareil;
  const repondre = (obj, status = 200) => json(obj, status, session.cookie);

  if (p === '/api/moi') return repondre({ moi });
  if (p === '/api/etat' && req.method === 'GET') return repondre(await etat(env, url.searchParams.get('mois')));
  if (p === '/api/sync' && req.method === 'POST') {
    const derniere = await lireReglage(env, 'synchro');
    if (derniere && Date.now() - Date.parse(derniere.date) < PAUSE_SYNCHRO) return repondre({ ...derniere, deja: true });
    return repondre(await synchroniser(env, psuDe(req)));
  }
  let m;
  // Classer une opération (catégorie et/ou projet). Ouvert à toute la famille.
  if ((m = p.match(/^\/api\/operations\/([^/]+)$/)) && req.method === 'PATCH') {
    const corps = await req.json();
    const id = decodeURIComponent(m[1]);
    const ops = [];
    if ('categorie' in corps) ops.push(env.DB.prepare('UPDATE operations SET categorie = ? WHERE id = ?').bind(corps.categorie || null, id));
    if ('projet' in corps) ops.push(env.DB.prepare('UPDATE operations SET projet = ? WHERE id = ?').bind(corps.projet ?? '', id));
    if ('note' in corps) ops.push(env.DB.prepare('UPDATE operations SET note = ? WHERE id = ?').bind(String(corps.note || '').trim().slice(0, 200) || null, id));
    if (ops.length) await env.DB.batch(ops);
    return repondre({ ok: true });
  }
  // Règle « toujours classer ce commerçant dans… ». Ouvert à toute la famille.
  if (p === '/api/regles' && req.method === 'POST') {
    // Une règle peut fixer la catégorie, le commentaire, ou les deux. Ce qui n'est pas fourni
    // reprend la valeur de la règle existante pour ce motif.
    const corps = await req.json();
    const mo = normaliser(corps.motif);
    if (mo.length < 3) return repondre({ erreur: 'Motif trop court.' }, 400);
    // Montant facultatif (centimes, valeur absolue) : la règle ne vaut que pour ce montant exact.
    const montant = Number.isFinite(Number(corps.montant)) && Number(corps.montant) > 0 ? Math.round(Math.abs(Number(corps.montant))) : null;
    const memeRegle = "motif = ? AND source = 'perso' AND COALESCE(montant, -1) = COALESCE(?, -1)";
    const ancienne = await env.DB.prepare(`SELECT categorie, note FROM regles WHERE ${memeRegle}`).bind(mo, montant).first();
    const categorie = 'categorie' in corps ? (corps.categorie || '') : (ancienne?.categorie || '');
    const note = 'note' in corps ? (String(corps.note || '').trim().slice(0, 200) || null) : (ancienne?.note || null);
    if (!categorie && !note) return repondre({ erreur: 'Rien à appliquer.' }, 400);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM regles WHERE ${memeRegle}`).bind(mo, montant),
      env.DB.prepare("INSERT INTO regles (id, motif, categorie, note, montant, source, cree) VALUES (?, ?, ?, ?, ?, 'perso', ?)").bind(crypto.randomUUID(), mo, categorie, note, montant, maintenant()),
    ]);
    return repondre({ ok: true, motif: mo });
  }
  if ((m = p.match(/^\/api\/regles\/([^/]+)$/)) && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM regles WHERE id = ?').bind(decodeURIComponent(m[1])).run();
    return repondre({ ok: true });
  }
  // Opérations d'une période (pour l'analyse et les moyennes), en format compact.
  if (p === '/api/historique' && req.method === 'GET') {
    // Opérations depuis un mois donné (13 mois par défaut), en format compact, pour la recherche,
    // les graphiques et l'analyse. date_compta : jour où l'argent a vraiment quitté le compte.
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 12);
    const depuis = /^\d{4}-\d{2}$/.test(url.searchParams.get('depuis') || '') ? url.searchParams.get('depuis') : d.toISOString().slice(0, 7);
    const r = await env.DB.prepare(`SELECT o.id, o.compte, o.date, o.montant, o.libelle, o.contrepartie, o.statut, o.categorie, o.projet, o.note, o.carte,
        COALESCE(json_extract(o.brut, '$.booking_date'), o.date) AS date_compta
      FROM operations o JOIN comptes c ON c.id = o.compte WHERE c.masque = 0 AND o.date >= ? ORDER BY o.date DESC, o.id`).bind(`${depuis}-01`).all();
    return repondre({ depuis, operations: r.results });
  }

  // Prévision : opérations récurrentes ignorées et opérations prévues ajoutées à la main. Toute la famille.
  // Solde du livret projets, saisi à la main (les livrets ne sont pas transmis par la banque).
  if (p === '/api/livret' && req.method === 'PUT') {
    const { solde } = await req.json();
    if (!Number.isFinite(Number(solde))) return repondre({ erreur: 'Montant invalide.' }, 400);
    await ecrireReglage(env, 'livret', { solde: Math.round(Number(solde)), date: maintenant().slice(0, 10) }).run();
    return repondre({ ok: true });
  }
  if (p === '/api/prevision' && req.method === 'PUT') {
    const c = await req.json();
    const ignores = [...new Set((c.ignores || []).map((x) => String(x).slice(0, 80)))].slice(0, 200);
    const aujourdhui = maintenant().slice(0, 10);
    const ajouts = (c.ajouts || []).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') && a.date >= aujourdhui && Number.isFinite(Number(a.montant)))
      .slice(0, 100).map((a) => ({ id: String(a.id || crypto.randomUUID()).slice(0, 40), date: a.date, libelle: String(a.libelle || 'Opération prévue').slice(0, 80), montant: Math.round(Number(a.montant)) }));
    // Corrections d'une opération récurrente : montant (centimes, signé) et/ou jour du mois.
    const modifs = Object.fromEntries(Object.entries(c.modifs || {}).slice(0, 100).map(([cle, v]) => [String(cle).slice(0, 80), {
      ...(Number.isFinite(Number(v?.montant)) ? { montant: Math.round(Number(v.montant)) } : {}),
      ...(Number(v?.jour) >= 1 && Number(v?.jour) <= 31 ? { jour: Math.round(Number(v.jour)) } : {}),
    }]).filter(([, v]) => Object.keys(v).length));
    // Opérations déclarées récurrentes depuis la liste : base = clé du libellé, montant signé, jour du mois.
    const recurrentes = (c.recurrentes || []).slice(0, 100).filter((r) => r.base && Number.isFinite(Number(r.montant)) && Number(r.jour) >= 1 && Number(r.jour) <= 31)
      .map((r) => ({ id: String(r.id || crypto.randomUUID()).slice(0, 40), base: String(r.base).slice(0, 80), libelle: String(r.libelle || '').slice(0, 80),
        montant: Math.round(Number(r.montant)), jour: Math.round(Number(r.jour)) }));
    await ecrireReglage(env, 'prevision', { ignores, ajouts, modifs, recurrentes }).run();
    return repondre({ ok: true });
  }

  if (p === '/api/deconnexion' && req.method === 'POST') {
    await env.DB.prepare('DELETE FROM appareils WHERE id = ?').bind(moi.id).run();
    return json({ ok: true }, 200, cookieEfface(req));
  }

  // --- réservé à l'administrateur ---
  if (!moi.admin) return repondre({ erreur: 'Réservé à l’administrateur.' }, 403);

  if (p === '/callback') return retourBanque(req, env, url);
  if (p === '/api/categories' && req.method === 'PUT') {
    const { categories } = await req.json();
    const TYPES = ['fixe', 'enveloppe', 'suivi', 'hors'];
    const valides = (categories || []).filter((c) => c.nom && TYPES.includes(c.type));
    const ids = valides.map((c) => c.id || crypto.randomUUID());
    await env.DB.batch([
      ...valides.map((c, i) => env.DB.prepare(`INSERT INTO categories (id, nom, type, budget, ordre) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nom = excluded.nom, type = excluded.type, budget = excluded.budget, ordre = excluded.ordre`)
        .bind(ids[i], String(c.nom).slice(0, 40), c.type, Math.max(0, Math.round(Number(c.budget) || 0)), i)),
      env.DB.prepare(`DELETE FROM categories WHERE id NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)),
      env.DB.prepare(`DELETE FROM regles WHERE categorie NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)),
      env.DB.prepare(`UPDATE operations SET categorie = NULL WHERE categorie IS NOT NULL AND categorie NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)),
    ]);
    return repondre({ ok: true });
  }
  // Données brutes envoyées par la banque, pour ajuster les règles (administrateur seulement).
  if ((m = p.match(/^\/api\/operations\/([^/]+)$/)) && req.method === 'GET') {
    const o = await env.DB.prepare('SELECT brut FROM operations WHERE id = ?').bind(decodeURIComponent(m[1])).first();
    return repondre({ brut: o?.brut ? JSON.parse(o.brut) : null });
  }
  if (p === '/api/cartes' && req.method === 'PUT') {
    const { noms } = await req.json();
    const propres = Object.fromEntries(Object.entries(noms || {}).filter(([k]) => /^\d{1,4}$/.test(k)).map(([k, v]) => [k, String(v || '').trim().slice(0, 30)]));
    await ecrireReglage(env, 'cartes', propres).run();
    return repondre({ ok: true });
  }
  if (p === '/api/projets' && req.method === 'POST' || (m = p.match(/^\/api\/projets\/([^/]+)$/)) && req.method === 'PUT') {
    const pr = await req.json();
    const id = m ? decodeURIComponent(m[1]) : crypto.randomUUID();
    const mois = (v) => (/^\d{4}-\d{2}$/.test(v || '') ? v : null);
    if (!String(pr.nom || '').trim() || !mois(pr.debut) || !mois(pr.fin)) return repondre({ erreur: 'Nom et période obligatoires.' }, 400);
    const motif = normaliser(pr.motif) || null;
    await env.DB.prepare(`INSERT INTO projets (id, nom, budget, debut, fin, motif, archive, cree) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET nom = excluded.nom, budget = excluded.budget, debut = excluded.debut, fin = excluded.fin,
        motif = excluded.motif, archive = excluded.archive`)
      .bind(id, String(pr.nom).trim().slice(0, 60), Math.max(0, Math.round(Number(pr.budget) || 0)), mois(pr.debut),
        pr.fin < pr.debut ? mois(pr.debut) : mois(pr.fin), motif, pr.archive ? 1 : 0, maintenant()).run();
    await rattacherProjets(env);
    return repondre({ ok: true, id });
  }
  if ((m = p.match(/^\/api\/projets\/([^/]+)$/)) && req.method === 'DELETE') {
    const id = decodeURIComponent(m[1]);
    await env.DB.batch([
      env.DB.prepare('UPDATE operations SET projet = NULL WHERE projet = ?').bind(id),
      env.DB.prepare('DELETE FROM projets WHERE id = ?').bind(id),
    ]);
    return repondre({ ok: true });
  }
  if (p === '/api/banques' && req.method === 'GET') {
    return repondre({ banques: await listerBanques(env, (url.searchParams.get('pays') || 'FR').toUpperCase()) });
  }
  if (p === '/api/banque/connecter' && req.method === 'POST') {
    const { nom, pays, duree } = await req.json();
    if (!nom || !pays) return repondre({ erreur: 'Banque manquante.' }, 400);
    const etatAleatoire = crypto.randomUUID();
    await ecrireReglage(env, 'attente', { etat: etatAleatoire, expire: Date.now() + 30 * 60000 }).run();
    const adresse = await demarrerAutorisation(env, { nom, pays, duree: Number(duree) || null }, `${url.origin}/callback`, etatAleatoire);
    return repondre({ url: adresse });
  }
  if ((m = p.match(/^\/api\/connexions\/([^/]+)$/)) && req.method === 'DELETE') {
    const id = decodeURIComponent(m[1]);
    await supprimerSession(env, id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM operations WHERE compte IN (SELECT id FROM comptes WHERE connexion = ?)').bind(id),
      env.DB.prepare('DELETE FROM comptes WHERE connexion = ?').bind(id),
      env.DB.prepare('DELETE FROM connexions WHERE id = ?').bind(id),
    ]);
    return repondre({ ok: true });
  }
  if ((m = p.match(/^\/api\/comptes\/([^/]+)$/)) && req.method === 'PATCH') {
    const c = await req.json();
    const type = ['courant', 'carte', 'epargne'].includes(c.type) ? c.type : 'courant';
    const jour = type === 'carte' ? Math.min(28, Math.max(1, Math.round(Number(c.jour_debit) || 4))) : null;
    await env.DB.prepare('UPDATE comptes SET masque = ?, type = ?, jour_debit = ?, nom = COALESCE(?, nom) WHERE id = ?')
      .bind(c.masque ? 1 : 0, type, jour, String(c.nom || '').trim().slice(0, 40) || null, decodeURIComponent(m[1])).run();
    return repondre({ ok: true });
  }
  if (p === '/api/invitations' && req.method === 'POST') {
    const { nom } = await req.json().catch(() => ({}));
    const prenom = String(nom || '').trim().slice(0, 40);
    if (!prenom) return repondre({ erreur: 'Indique un prénom.' }, 400);
    const inv = await creerInvitation(env, prenom);
    return repondre({ ...inv, lien: `${url.origin}/i/${inv.code}` });
  }
  if (p === '/api/appareils' && req.method === 'GET') {
    const r = await env.DB.prepare('SELECT id, nom, admin, cree, vu FROM appareils ORDER BY cree').all();
    return repondre({ appareils: r.results.map((a) => ({ ...a, admin: !!a.admin, moi: a.id === moi.id })) });
  }
  if ((m = p.match(/^\/api\/appareils\/([^/]+)$/)) && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM appareils WHERE id = ?').bind(decodeURIComponent(m[1])).run();
    return repondre({ ok: true });
  }
  return repondre({ erreur: 'Introuvable.' }, 404);
}

// ---------- retour de la banque après ton accord ----------
async function retourBanque(req, env, url) {
  const echec = (message) => redirection(`/?banque=erreur&message=${encodeURIComponent(message)}`);
  const attente = await lireReglage(env, 'attente');
  await env.DB.prepare("DELETE FROM reglages WHERE cle = 'attente'").run();
  if (url.searchParams.get('error')) {
    return echec(url.searchParams.get('error_description') || url.searchParams.get('error'));
  }
  const code = url.searchParams.get('code');
  if (!code || !attente || attente.etat !== url.searchParams.get('state') || Date.now() > attente.expire) {
    return echec('Lien de retour invalide ou trop ancien. Recommence la connexion.');
  }
  let s;
  try {
    s = await finaliserAutorisation(env, code);
  } catch (e) {
    return echec(e.message);
  }
  if (!s.comptes.length) return echec('La banque n’a partagé aucun compte.');

  const instructions = [
    env.DB.prepare('INSERT INTO connexions (id, banque, pays, expire, cree, statut) VALUES (?, ?, ?, ?, ?, \'active\') ON CONFLICT(id) DO UPDATE SET expire = excluded.expire, statut = \'active\', erreur = NULL')
      .bind(s.id, s.banque, s.pays, s.expire, maintenant()),
  ];
  for (const c of s.comptes) {
    instructions.push(env.DB.prepare(`INSERT INTO comptes (id, uid, connexion, nom, iban, devise) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET uid = excluded.uid, connexion = excluded.connexion, nom = excluded.nom, iban = excluded.iban, devise = excluded.devise`)
      .bind(c.id, c.uid, s.id, c.nom, c.iban, c.devise));
  }
  await env.DB.batch(instructions);

  // Les anciennes autorisations dont tous les comptes ont été repris (renouvellement) disparaissent.
  const orphelines = await env.DB.prepare('SELECT id FROM connexions WHERE id != ? AND id NOT IN (SELECT connexion FROM comptes)').bind(s.id).all();
  for (const o of orphelines.results) {
    await supprimerSession(env, o.id);
    await env.DB.prepare('DELETE FROM connexions WHERE id = ?').bind(o.id).run();
  }

  const rapport = await synchroniser(env, psuDe(req), s.id);
  const suite = rapport.erreurs.length ? `&message=${encodeURIComponent(rapport.erreurs.join(' · '))}` : '';
  return redirection(`/?banque=ok${suite}`);
}

// ---------- synchronisation ----------
export async function synchroniser(env, psu, seulementConnexion = null) {
  const rapport = { date: maintenant(), comptes: 0, operations: 0, erreurs: [] };

  // Autorisations arrivées à échéance.
  await env.DB.prepare("UPDATE connexions SET statut = 'expiree' WHERE statut = 'active' AND expire IS NOT NULL AND expire < ?").bind(maintenant()).run();

  let sql = "SELECT c.*, x.banque FROM comptes c JOIN connexions x ON x.id = c.connexion WHERE x.statut = 'active'";
  const params = [];
  if (seulementConnexion) { sql += ' AND x.id = ?'; params.push(seulementConnexion); }
  const comptes = (await env.DB.prepare(sql).bind(...params).all()).results;

  const perdues = new Set();
  for (const c of comptes) {
    if (perdues.has(c.connexion)) continue;
    try {
      const solde = await lireSolde(env, c.uid, psu);
      const initial = !c.synchro;
      let depuis = initial ? Date.now() - HISTORIQUE_INITIAL * JOUR : Date.parse(c.synchro) - RECOUVREMENT * JOUR;
      let brutes;
      try {
        brutes = await lireOperations(env, c.uid, jourISO(depuis), psu);
      } catch (e) {
        // Certaines banques refusent plus de 90 jours d'historique : on se contente de 89.
        if (!initial || !(e instanceof ErreurBanque) || e.autorisationPerdue) throw e;
        depuis = Date.now() - 89 * JOUR;
        brutes = await lireOperations(env, c.uid, jourISO(depuis), psu);
      }
      const lignes = await convertir(c.id, brutes);
      await env.DB.batch([
        // Les opérations « en cours » sont remplacées à chaque fois par ce que dit la banque.
        env.DB.prepare("DELETE FROM operations WHERE compte = ? AND statut = 'PDNG'").bind(c.id),
        // Une seule requête pour toutes les opérations (limite de requêtes du plan gratuit).
        env.DB.prepare(`INSERT INTO operations (id, compte, date, montant, libelle, contrepartie, statut, carte, brut, vu)
          SELECT json_extract(j.value, '$.id'), ?2, json_extract(j.value, '$.date'), json_extract(j.value, '$.montant'),
                 json_extract(j.value, '$.libelle'), json_extract(j.value, '$.contrepartie'), json_extract(j.value, '$.statut'),
                 json_extract(j.value, '$.carte'), json_extract(j.value, '$.brut'), ?3
          FROM json_each(?1) AS j WHERE true
          ON CONFLICT(id) DO UPDATE SET date = excluded.date, montant = excluded.montant, libelle = excluded.libelle,
            contrepartie = excluded.contrepartie, statut = excluded.statut, carte = excluded.carte, brut = excluded.brut`)
          .bind(JSON.stringify(lignes), c.id, rapport.date),
        env.DB.prepare('UPDATE comptes SET solde = COALESCE(?, solde), solde_type = COALESCE(?, solde_type), solde_date = COALESCE(?, solde_date), synchro = ? WHERE id = ?')
          .bind(solde?.montant ?? null, solde?.type ?? null, solde?.date ?? null, rapport.date, c.id),
      ]);
      rapport.comptes++;
      rapport.operations += lignes.length;
    } catch (e) {
      console.log(`synchro ${c.nom}`, e.stack || e.message);
      if (e instanceof ErreurBanque && e.autorisationPerdue) {
        perdues.add(c.connexion);
        await env.DB.prepare("UPDATE connexions SET statut = 'expiree', erreur = ? WHERE id = ?").bind(e.message, c.connexion).run();
        rapport.erreurs.push(`${c.banque} : autorisation à renouveler`);
      } else {
        rapport.erreurs.push(`${c.nom} : ${e.message}`);
      }
    }
  }
  if (rapport.operations) {
    await fusionnerPaiementsCarte(env);
    await rattacherProjets(env);
  }
  await ecrireReglage(env, 'synchro', rapport).run();
  return rapport;
}

// ---------- données pour l'app ----------
async function etat(env, mois) {
  if (!/^\d{4}-\d{2}$/.test(mois || '')) mois = maintenant().slice(0, 7);
  const [debut, fin] = [`${mois}-01`, `${mois}-31`];
  const [comptes, connexions, operations, bornes, synchro, categories, regles, projets, encours, cartes, nomsCartes, prevision, livret] = await env.DB.batch([
    env.DB.prepare(`SELECT c.id, c.nom, c.iban, c.devise, c.solde, c.solde_type, c.solde_date, c.synchro, c.masque, c.connexion, c.type, c.jour_debit, x.banque
      FROM comptes c JOIN connexions x ON x.id = c.connexion ORDER BY x.banque, c.nom`),
    env.DB.prepare('SELECT id, banque, pays, expire, cree, statut, erreur FROM connexions ORDER BY cree'),
    // Le mois demandé, plus les 10 premiers jours du mois suivant : le prélèvement des cartes
    // à débit différé (le 4) couvre les achats du mois demandé.
    env.DB.prepare(`SELECT o.id, o.compte, o.date, o.montant, o.libelle, o.contrepartie, o.statut, o.vu, o.categorie, o.projet, o.carte, o.note
      FROM operations o JOIN comptes c ON c.id = o.compte
      WHERE c.masque = 0 AND o.date BETWEEN ? AND ?
      ORDER BY o.date DESC, o.vu DESC, o.id`).bind(debut, `${suivant(mois)}-10`),
    env.DB.prepare('SELECT MIN(date) AS premier FROM operations'),
    env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'synchro'"),
    env.DB.prepare('SELECT id, nom, type, budget FROM categories ORDER BY ordre'),
    env.DB.prepare('SELECT id, motif, categorie, note, montant, source FROM regles'),
    env.DB.prepare(`SELECT p.id, p.nom, p.budget, p.debut, p.fin, p.motif, p.archive,
      COALESCE((SELECT -SUM(o.montant) FROM operations o WHERE o.projet = p.id), 0) AS depense,
      (SELECT COUNT(*) FROM operations o WHERE o.projet = p.id) AS nombre
      FROM projets p ORDER BY p.archive, p.debut`),
    // Paiements carte pas encore débités, par compte et par carte.
    env.DB.prepare(`SELECT o.compte, o.carte, -SUM(o.montant) AS montant, MIN(o.date) AS depuis FROM operations o
      JOIN comptes c ON c.id = o.compte WHERE o.statut = 'AVNR' AND c.masque = 0 GROUP BY o.compte, o.carte`),
    env.DB.prepare(`SELECT DISTINCT o.carte FROM operations o JOIN comptes c ON c.id = o.compte WHERE o.carte IS NOT NULL AND c.masque = 0`),
    env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'cartes'"),
    env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'prevision'"),
    env.DB.prepare("SELECT valeur FROM reglages WHERE cle = 'livret'"),
  ]);
  return {
    mois,
    premierMois: bornes.results[0]?.premier?.slice(0, 7) || mois,
    comptes: comptes.results.map((c) => ({ ...c, masque: !!c.masque, iban: c.iban ? `•••• ${c.iban.slice(-4)}` : null })),
    connexions: connexions.results,
    operations: operations.results,
    synchro: synchro.results[0] ? JSON.parse(synchro.results[0].valeur) : null,
    categories: categories.results,
    regles: regles.results,
    projets: projets.results.map((p) => ({ ...p, archive: !!p.archive })),
    encours: encours.results,
    cartes: cartes.results.map((c) => c.carte).sort(),
    nomsCartes: nomsCartes.results[0] ? JSON.parse(nomsCartes.results[0].valeur) : {},
    prevision: prevision.results[0] ? JSON.parse(prevision.results[0].valeur) : { ignores: [], ajouts: [] },
    livret: livret.results[0] ? JSON.parse(livret.results[0].valeur) : null,
  };
}
