// Budget — interface
'use strict';

const $ = (id) => document.getElementById(id);
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurosSigne = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const fmt = (centimes) => euros.format((centimes || 0) / 100);
const fmtSigne = (centimes) => eurosSigne.format((centimes || 0) / 100);
const nomMois = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const nomJour = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dateCourte = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aujourdhui = () => isoLocal(new Date());
const moisCourant = () => aujourdhui().slice(0, 7);
const decalerMois = (m, n) => { const d = new Date(`${m}-15T12:00:00`); d.setMonth(d.getMonth() + n); return isoLocal(d).slice(0, 7); };
const joursDansMois = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function lire(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }

const estInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const estIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let moi = null;
let donnees = null;
let mois = moisCourant();
let invitationInstall = null;
let filtre = 'toutes';

class NonActive extends Error {}

async function api(chemin, options = {}) {
  const r = await fetch(chemin, {
    ...options,
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && chemin !== '/api/activer') throw new NonActive(d.erreur);
  if (!r.ok) throw new Error(d.erreur || `Erreur ${r.status}`);
  return d;
}

function statut(texte, auto = false) {
  $('statut').textContent = texte || '';
  if (auto) $('statut').dataset.auto = '1'; else delete $('statut').dataset.auto;
}

// ---------- démarrage ----------
async function demarrer() {
  const params = new URLSearchParams(location.search);
  const messageBanque = params.get('banque') === 'ok'
    ? `Banque connectée ✓${params.get('message') ? ` (${params.get('message')})` : ''}`
    : params.get('banque') === 'erreur' ? `Connexion à la banque impossible : ${params.get('message') || 'raison inconnue'}` : null;
  const codeInvitation = location.pathname.startsWith('/i/') ? decodeURIComponent(location.pathname.slice(3)) : null;
  if (messageBanque || codeInvitation) history.replaceState(null, '', '/');

  try {
    moi = (await api('/api/moi')).moi;
  } catch (e) {
    if (e instanceof NonActive) return afficherActivation(codeInvitation);
    // Hors ligne : on montre les dernières données connues.
    moi = lire('moi');
    if (!moi) return afficherActivation(codeInvitation);
  }
  ecrire('moi', moi);
  afficherApp();
  if (messageBanque) statut(messageBanque);
  if (params.get('banque') === 'erreur') afficherPage('reglages');
}

// ---------- activation ----------
function afficherActivation(code) {
  $('app').hidden = true;
  $('installer').hidden = true;
  $('activation').hidden = false;
  $('act-invitation').hidden = !code;
  if (code) $('code').value = code;
}

async function activerAvec(code, nom) {
  $('erreur-activation').textContent = '';
  try {
    const r = await api('/api/activer', { method: 'POST', body: JSON.stringify({ code, nom }) });
    moi = r.moi;
    ecrire('moi', moi);
    if (estInstallee()) afficherApp();
    else afficherGuideInstallation();
  } catch (e) {
    $('erreur-activation').textContent = e.message;
  }
}

$('btn-activer-invitation').addEventListener('click', () => activerAvec($('code').value, ''));
$('form-activation').addEventListener('submit', (e) => {
  e.preventDefault();
  activerAvec($('code').value, $('nom-appareil').value);
});

function afficherGuideInstallation() {
  $('activation').hidden = true;
  $('installer').hidden = false;
  const ios = estIOS();
  $('guide-ios').hidden = !ios;
  $('guide-android').hidden = ios;
  $('btn-installer').hidden = !invitationInstall;
  $('guide-android-menu').hidden = !!invitationInstall;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  invitationInstall = e;
  if (!$('installer').hidden) { $('btn-installer').hidden = false; $('guide-android-menu').hidden = true; }
});
$('btn-installer').addEventListener('click', async () => {
  if (!invitationInstall) return;
  invitationInstall.prompt();
  await invitationInstall.userChoice.catch(() => null);
  invitationInstall = null;
  afficherApp();
});
$('btn-continuer').addEventListener('click', () => afficherApp());


// ---------- classement des opérations ----------
// Tout le classement se fait sur le téléphone : le serveur ne garde que les choix manuels.

const normaliser = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let reglesPretes = null;
function preparerRegles(d) {
  const cats = new Set(d.categories.map((c) => c.id));
  reglesPretes = d.regles
    .filter((r) => cats.has(r.categorie) && r.motif.trim())
    .map((r) => ({ ...r, re: new RegExp(`(^|[^A-Z])${echapperRegex(r.motif.trim())}(?=[^A-Z]|$)`) }))
    // Tes règles d'abord, puis le motif le plus long (le plus précis).
    .sort((a, b) => (a.source === 'perso' ? 0 : 1) - (b.source === 'perso' ? 0 : 1) || b.motif.trim().length - a.motif.trim().length);
}

function categorieDe(o, d) {
  if (o.categorie && d.categories.some((c) => c.id === o.categorie)) return o.categorie;
  const texte = normaliser(`${o.libelle} ${o.contrepartie || ''}`);
  for (const r of reglesPretes) if (r.re.test(texte)) return r.categorie;
  return o.montant > 0 && d.categories.some((c) => c.id === 'revenus') ? 'revenus' : null;
}

// Motif proposé pour « toujours classer ainsi » : le commerçant, sans les mots bancaires.
function motifPropose(o) {
  const base = normaliser(o.contrepartie || o.libelle)
    .replace(/\b(PAIEMENT|CB|CARTE|PRLV|SEPA|VIR|VIREMENT|INST|RETRAIT|DAB|ACHAT|FACT|DU|LE)\b/g, ' ')
    .replace(/\bX?\d[\d/.:-]*\b/g, ' ')
    .replace(/[^A-Z0-9&' ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return base.split(' ').slice(0, 3).join(' ');
}

const nomCarte = (d, carte) => {
  const nom = d.nomsCartes?.[carte];
  return carte === '?' ? 'Carte' : `Carte …${carte}${nom ? ` (${nom})` : ''}`;
};
const typeCompte = (d, id) => d.comptes.find((c) => c.id === id)?.type || 'courant';
const nomCategorie = (d, id) => d.categories.find((c) => c.id === id)?.nom || 'À classer';

// Calcule tous les indicateurs du mois affiché.
function calculer(d) {
  preparerRegles(d);
  const enCours = d.mois === moisCourant();
  const passe = d.mois < moisCourant();
  const jour = enCours ? new Date().getDate() : passe ? joursDansMois(d.mois) : 0;
  const nbJours = joursDansMois(d.mois);
  const fraction = enCours ? jour / nbJours : passe ? 1 : 0;

  const parCat = Object.fromEntries(d.categories.map((c) => [c.id, 0]));
  const ops = [];
  let aClasser = 0;
  // Les mois passés n'ont souvent pas le détail des paiements carte (la banque ne le transmet plus
  // une fois débité) : le prélèvement du mois suivant compte alors comme dépense du mois.
  const detailCartes = d.operations.some((o) => o.carte && o.date.startsWith(d.mois));
  let cartesSansDetail = 0;
  const debitsCartes = [];
  if (!detailCartes) {
    for (const o of d.operations) {
      if (o.date > `${d.mois}-31` && o.montant < 0 && typeCompte(d, o.compte) !== 'epargne' && categorieDe(o, d) === 'differe') {
        cartesSansDetail -= o.montant;
        debitsCartes.push({ ...o, cat: 'differe', projetNom: null, epargne: false });
      }
    }
  }
  let depenseAClasser = 0;
  for (const o of d.operations) {
    if (!o.date.startsWith(d.mois)) continue;     // début du mois suivant : sert seulement au prélèvement carte
    const epargne = typeCompte(d, o.compte) === 'epargne';
    const projet = o.projet ? d.projets.find((p) => p.id === o.projet) : null;
    const cat = epargne ? null : categorieDe(o, d);
    const x = { ...o, cat, projetNom: projet?.nom || null, epargne };
    ops.push(x);
    if (epargne || projet) continue;
    if (cat) parCat[cat] -= o.montant;
    else { aClasser++; depenseAClasser -= o.montant; }
  }

  const cats = d.categories.map((c) => ({ ...c, depense: parCat[c.id] || 0 }));
  const budgetes = cats.filter((c) => c.type === 'fixe' || c.type === 'enveloppe');
  const enveloppes = cats.filter((c) => c.type === 'enveloppe');
  const totalBudget = budgetes.reduce((s, c) => s + c.budget, 0);
  // Ce qui n'est pas encore classé et les cartes sans détail comptent aussi : ce sont des dépenses réelles.
  const totalDepense = budgetes.reduce((s, c) => s + Math.max(c.depense, 0), 0) + Math.max(depenseAClasser, 0) + cartesSansDetail;
  const resteEnveloppes = enveloppes.reduce((s, c) => s + Math.max(c.budget - c.depense, 0), 0);
  const joursRestants = enCours ? nbJours - jour + 1 : 0;

  // Disponible = comptes courants − paiements carte pas encore débités (débit différé).
  let courant = 0, epargne = 0;
  for (const c of d.comptes.filter((x) => !x.masque)) {
    if (c.type === 'epargne') epargne += c.solde || 0;
    else courant += c.solde || 0;
  }
  const encoursParCarte = {};
  for (const e of d.encours || []) encoursParCarte[e.carte || '?'] = (encoursParCarte[e.carte || '?'] || 0) + e.montant;
  const encours = Object.values(encoursParCarte).reduce((t, v) => t + v, 0);
  return {
    enCours, passe, jour, nbJours, fraction, cats, ops, aClasser, totalBudget, totalDepense,
    resteEnveloppes, joursRestants, courant, encours, encoursParCarte, epargne,
    revenus: parCat.revenus || 0, depenseAClasser, cartesSansDetail, debitsCartes,
  };
}

// ---------- application ----------
function afficherApp() {
  $('activation').hidden = true;
  $('installer').hidden = true;
  $('app').hidden = false;
  $('moi-nom').textContent = moi ? `Activé au nom de ${moi.nom}${moi.admin ? ' (administrateur)' : ''}.` : '';
  for (const id of ['bloc-banque', 'bloc-famille', 'bloc-budgets', 'bloc-projets', 'bloc-comptes']) $(id).hidden = !moi?.admin;
  const cache = lire(`etat:${mois}`);
  if (cache?.categories) { donnees = cache; dessiner(); }
  charger();
}

async function charger() {
  try {
    donnees = await api(`/api/etat?mois=${mois}`);
    ecrire(`etat:${mois}`, donnees);
    dessiner();
  } catch (e) {
    if (e instanceof NonActive) return afficherActivation(null);
    statut(donnees ? 'Hors ligne : dernières données connues.' : e.message);
  }
}

let calcul = null;
function dessiner() {
  const d = donnees;
  if (!d?.categories) return;
  calcul = calculer(d);
  if (!$('statut').textContent || $('statut').dataset.auto) statut(d.synchro ? `Mis à jour ${depuis(d.synchro.date)}` : '', true);
  dessinerAlertes(d);
  document.querySelectorAll('.mois-nom').forEach((e) => { e.textContent = nomMois(d.mois); });
  document.querySelectorAll('.mois-prec').forEach((b) => { b.disabled = d.mois <= d.premierMois; });
  document.querySelectorAll('.mois-suiv').forEach((b) => { b.disabled = d.mois >= moisCourant(); });
  dessinerAccueil(d, calcul);
  dessinerOperations(d, calcul);
  if (!$('page-reglages').hidden) dessinerReglages();
}

// ---------- Aujourd'hui ----------
function dessinerAccueil(d, k) {
  const reste = k.totalBudget - k.totalDepense;
  $('reste-titre').textContent = k.passe ? 'Bilan du mois' : 'Reste à dépenser';
  $('reste').textContent = fmt(k.passe ? k.totalBudget - k.totalDepense : reste);
  $('reste').classList.toggle('negatif', reste < 0);
  $('reste-detail').textContent = `${fmt(k.totalDepense)} dépensés sur ${fmt(k.totalBudget)}${k.enCours ? ` · jour ${k.jour}/${k.nbJours}` : ''}`;
  $('par-jour').textContent = k.enCours && k.joursRestants > 0
    ? `Courses, shopping et transports : ${fmt(k.resteEnveloppes / k.joursRestants)} par jour jusqu’à la fin du mois.`
    : k.passe ? (reste >= 0 ? 'Budget tenu ✓' : 'Budget dépassé.') : '';

  $('lien-a-classer').hidden = !k.aClasser;
  $('lien-a-classer').textContent = `${k.aClasser} opération${k.aClasser > 1 ? 's' : ''} à classer ›`;

  // Anneaux des enveloppes : rempli = dépensé, repère = rythme attendu à cette date.
  const env = k.cats.filter((c) => c.type === 'enveloppe');
  $('anneaux').innerHTML = env.map((c) => {
    const attendu = Math.round(c.budget * k.fraction);
    const ecart = attendu - c.depense;
    const etat = c.depense > c.budget ? 'depasse' : c.depense > attendu ? 'avance' : 'ok';
    const message = c.budget === 0 ? 'Sans budget'
      : etat === 'depasse' ? `Dépassé de ${fmt(c.depense - c.budget)}`
      : !k.enCours ? `Reste ${fmt(c.budget - c.depense)}`
      : ecart >= 0 ? `Marge ${fmt(ecart)}` : `En avance de ${fmt(-ecart)}`;
    return `<button class="anneau ${etat}" data-cat="${echapper(c.id)}">
      ${svgAnneau(c.budget ? c.depense / c.budget : 0, k.enCours ? k.fraction : null)}
      <span class="anneau-pct">${c.budget ? Math.round((c.depense / c.budget) * 100) : 0} %</span>
      <span class="anneau-nom">${echapper(c.nom)}</span>
      <span class="anneau-montant">${fmt(c.depense)} / ${fmt(c.budget)}</span>
      <span class="anneau-etat">${message}</span></button>`;
  }).join('') || '<p class="vide">Aucune enveloppe : ajoute-en dans Réglages.</p>';

  $('fixes').innerHTML = k.cats.filter((c) => c.type === 'fixe').map((c) => barre(c.nom, c.depense, c.budget,
    c.depense >= c.budget * 0.98 ? 'Passé ✓' : `Reste ${fmt(c.budget - c.depense)}`, c.id)).join('');

  const projets = d.projets.filter((p) => !p.archive && p.debut <= d.mois && p.fin >= decalerMois(d.mois, -1));
  $('section-projets').hidden = !projets.length;
  $('projets').innerHTML = projets.map((p) => barre(p.nom, p.depense, p.budget,
    `${periode(p)} · ${p.depense > p.budget ? `dépassé de ${fmt(p.depense - p.budget)}` : `reste ${fmt(p.budget - p.depense)}`}`)).join('');

  const suivi = k.cats.filter((c) => c.type === 'suivi' && c.depense);
  if (k.depenseAClasser > 0) suivi.unshift({ id: '__aclasser', nom: 'À classer (compté dans le reste)', depense: k.depenseAClasser });
  if (k.cartesSansDetail) suivi.unshift({ id: 'differe', nom: 'Cartes, détail non transmis par la banque', depense: k.cartesSansDetail });
  if (k.revenus) suivi.push({ id: 'revenus', nom: 'Revenus du mois', depense: -k.revenus, revenu: true });
  $('section-suivi').hidden = !suivi.length;
  $('suivi').innerHTML = suivi.map((c) => `<li><button data-cat="${echapper(c.id)}"><span>${echapper(c.nom)}</span>
    <b class="${c.revenu ? 'positif' : ''}">${fmt(Math.abs(c.depense))}</b></button></li>`).join('');

  // Comptes
  const visibles = d.comptes.filter((c) => !c.masque);
  $('dispo').textContent = visibles.length ? fmt(k.courant - k.encours) : '–';
  $('dispo-detail').textContent = !visibles.length ? '' : k.encours
    ? `solde ${fmt(k.courant)} − cartes à débiter ${fmt(k.encours)}`
    : 'sur les comptes courants';
  const ordre = { courant: 0, carte: 0, epargne: 2 };
  const lignesCartes = Object.entries(k.encoursParCarte).filter(([, v]) => v).map(([carte, v]) =>
    `<li><span class="nom">${echapper(nomCarte(d, carte))}<small>paiements à débiter (débit différé)</small></span>
      <span class="montant">−${fmt(v)}</span></li>`);
  $('comptes').innerHTML = visibles.length
    ? [...visibles].sort((a, b) => ordre[a.type] - ordre[b.type]).map((c) => {
      const detail = c.type === 'epargne' ? 'épargne' : c.banque;
      return `<li><span class="nom">${echapper(c.nom)}<small>${echapper(detail)}${c.iban ? ` · ${echapper(c.iban)}` : ''}</small></span>
        <span class="montant ${c.solde < 0 ? 'negatif' : ''}">${c.solde == null ? '–' : fmt(c.solde)}</span></li>`;
    }).concat(lignesCartes).join('')
    : `<li class="vide">${moi?.admin ? 'Aucun compte : connecte ta banque dans Réglages.' : 'Aucun compte connecté pour l’instant.'}</li>`;
}

function svgAnneau(part, repere) {
  const r = 30, c = 2 * Math.PI * r;
  const p = Math.min(Math.max(part, 0), 1);
  let marque = '';
  if (repere != null) {
    const a = repere * 2 * Math.PI - Math.PI / 2;
    const [x1, y1, x2, y2] = [36 + 24 * Math.cos(a), 36 + 24 * Math.sin(a), 36 + 36 * Math.cos(a), 36 + 36 * Math.sin(a)];
    marque = `<line class="repere" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<svg viewBox="0 0 72 72" aria-hidden="true"><circle class="piste" cx="36" cy="36" r="${r}"/>
    <circle class="rempli" cx="36" cy="36" r="${r}" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 36 36)"/>${marque}</svg>`;
}

function barre(nom, depense, budget, detail, cat) {
  const part = budget ? Math.min(Math.max(depense / budget, 0), 1) : 0;
  const etat = depense > budget ? 'depasse' : '';
  const attr = cat ? ` data-cat="${echapper(cat)}"` : '';
  return `<li><button${attr} class="${etat}"><span class="barre-haut"><span>${echapper(nom)}</span><b>${fmt(depense)} <small>/ ${fmt(budget)}</small></b></span>
    <span class="jauge"><i style="width:${(part * 100).toFixed(1)}%"></i></span><small>${echapper(detail)}</small></button></li>`;
}

const moisCourt = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
const periode = (p) => (p.debut === p.fin ? moisCourt(p.debut) : `${moisCourt(p.debut)} → ${moisCourt(p.fin)}`);

// Toucher une enveloppe ou une ligne : voir ses opérations.
let filtreCat = null;
$('page-accueil').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  if (b.dataset.cat === '__aclasser') { filtre = 'aclasser'; afficherPage('operations'); return; }
  filtreCat = b.dataset.cat;
  filtre = 'categorie';
  afficherPage('operations');
});
$('lien-a-classer').addEventListener('click', () => { filtre = 'aclasser'; afficherPage('operations'); });

function dessinerAlertes(d) {
  const alertes = [];
  const dans = (iso) => Math.round((Date.parse(iso) - Date.now()) / 86400000);
  for (const c of d.connexions) {
    if (c.statut !== 'active') {
      alertes.push({ grave: true, texte: `L’accès à ${c.banque} a expiré : les opérations ne se mettent plus à jour.`, banque: c });
    } else if (c.expire && dans(c.expire) <= 14) {
      alertes.push({ texte: `L’accès à ${c.banque} expire dans ${Math.max(dans(c.expire), 0)} jour(s).`, banque: c });
    }
  }
  if (d.synchro?.erreurs?.length) alertes.push({ texte: `Dernière synchro incomplète : ${d.synchro.erreurs.join(' · ')}` });
  $('alertes').innerHTML = alertes.map((a, i) => `<div class="alerte ${a.grave ? 'grave' : ''}">${echapper(a.texte)}
    ${a.banque && moi?.admin ? ` <button data-renouveler="${i}">Renouveler</button>` : a.banque ? ' Préviens l’administrateur.' : ''}</div>`).join('');
  $('alertes').querySelectorAll('[data-renouveler]').forEach((b) => b.addEventListener('click', () => renouveler(alertes[b.dataset.renouveler].banque)));
}

function depuis(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

document.querySelectorAll('.mois-prec').forEach((b) => b.addEventListener('click', () => changerMois(-1)));
document.querySelectorAll('.mois-suiv').forEach((b) => b.addEventListener('click', () => changerMois(1)));
function changerMois(n) {
  mois = decalerMois(mois, n);
  const cache = lire(`etat:${mois}`);
  if (cache?.categories) { donnees = cache; dessiner(); }
  else $('operations').innerHTML = '<p class="vide">Chargement…</p>';
  charger();
}

$('btn-sync').addEventListener('click', async () => {
  const b = $('btn-sync');
  if (b.classList.contains('tourne')) return;
  b.classList.add('tourne');
  statut('Synchronisation avec la banque…');
  try {
    const r = await api('/api/sync', { method: 'POST' });
    statut(r.deja ? 'Déjà à jour.' : r.erreurs.length ? `Synchro incomplète : ${r.erreurs.join(' · ')}` : `Synchro terminée : ${r.comptes} compte(s).`);
    await charger();
  } catch (e) {
    if (e instanceof NonActive) return afficherActivation(null);
    statut(`Synchro impossible : ${e.message}`);
  } finally {
    b.classList.remove('tourne');
  }
});

// ---------- Opérations ----------
function dessinerOperations(d, k) {
  $('nb-a-classer').textContent = k.aClasser ? `(${k.aClasser})` : '';
  document.querySelectorAll('[data-filtre]').forEach((b) => b.classList.toggle('actif', b.dataset.filtre === filtre));
  let liste = k.ops;
  let titreFiltre = '';
  if (filtre === 'aclasser') liste = liste.filter((o) => !o.cat && !o.projet && !o.epargne);
  if (filtre === 'categorie') {
    liste = filtreCat === 'differe' && k.cartesSansDetail ? k.debitsCartes
      : filtreCat === 'revenus' ? liste.filter((o) => o.cat === 'revenus' && !o.projet) : liste.filter((o) => o.cat === filtreCat && !o.projet && !o.epargne);
    titreFiltre = `<p class="filtre-actif">${echapper(nomCategorie(d, filtreCat))} <button data-filtre="toutes">× tout afficher</button></p>`;
  }
  const entrees = k.ops.filter((o) => o.montant > 0).reduce((s, o) => s + o.montant, 0);
  const sorties = k.ops.filter((o) => o.montant < 0).reduce((s, o) => s + o.montant, 0);
  $('entrees').textContent = fmt(entrees);
  $('sorties').textContent = fmt(-sorties);
  $('ecart').textContent = fmtSigne(entrees + sorties);
  $('ecart').className = entrees + sorties < 0 ? 'negatif' : 'positif';

  const multi = d.comptes.length > 1;
  const nomsComptes = Object.fromEntries(d.comptes.map((c) => [c.id, c.nom]));
  let html = titreFiltre, jourCourant = null;
  for (const o of liste) {
    if (o.date !== jourCourant) { jourCourant = o.date; html += `<h3 class="jour">${nomJour(o.date)}</h3>`; }
    const etiquette = o.epargne ? 'Épargne' : o.projetNom ? `Projet · ${o.projetNom}` : o.cat ? nomCategorie(d, o.cat) : 'À classer';
    const detail = [o.contrepartie && o.contrepartie !== o.libelle ? o.contrepartie : null,
      o.carte ? nomCarte(d, o.carte) : multi ? nomsComptes[o.compte] : null].filter(Boolean).join(' · ');
    html += `<button class="op ${o.statut === 'PDNG' ? 'encours' : o.statut === 'AVNR' ? 'adebiter' : ''}" data-op="${echapper(o.id)}">
      <span class="libelle">${echapper(o.libelle)}</span>
      <span class="montant ${o.montant > 0 ? 'positif' : ''}">${fmtSigne(o.montant)}</span>
      <span class="puce-cat ${!o.cat && !o.projetNom && !o.epargne ? 'vide' : ''} ${o.categorie || (o.projet && o.projet !== '') ? 'manuel' : ''}">${echapper(etiquette)}</span>
      ${detail ? `<small>${echapper(detail)}</small>` : ''}</button>`;
  }
  $('operations').innerHTML = html || `<p class="vide">${filtre === 'aclasser' ? 'Tout est classé ✓' : 'Aucune opération.'}</p>`;
}

document.querySelectorAll('.filtres [data-filtre]').forEach((b) => b.addEventListener('click', () => { filtre = b.dataset.filtre; dessiner(); }));
$('operations').addEventListener('click', (e) => {
  if (e.target.closest('[data-filtre]')) { filtre = 'toutes'; dessiner(); return; }
  const b = e.target.closest('[data-op]');
  if (b) ouvrirFiche(calcul.ops.find((o) => o.id === b.dataset.op));
});

// ---------- fiche d'une opération ----------
let ficheOp = null, ficheCat = null;
function ouvrirFiche(o) {
  if (!o) return;
  const d = donnees;
  ficheOp = o;
  ficheCat = o.cat;
  $('fiche-date').textContent = nomJour(o.date);
  $('fiche-libelle').textContent = o.libelle;
  $('fiche-montant').textContent = fmtSigne(o.montant);
  $('fiche-montant').className = `fiche-montant ${o.montant > 0 ? 'positif' : ''}`;
  $('fiche-compte').textContent = [o.contrepartie, o.carte ? nomCarte(d, o.carte) : null, d.comptes.find((c) => c.id === o.compte)?.nom,
    o.statut === 'PDNG' ? 'en cours' : o.statut === 'AVNR' ? 'pas encore débité' : null].filter(Boolean).join(' · ');
  $('fiche-categories').innerHTML = d.categories.map((c) => `<button type="button" role="radio" aria-checked="${c.id === ficheCat}" data-c="${echapper(c.id)}">${echapper(c.nom)}</button>`).join('');
  $('fiche-regle').hidden = true;
  $('fiche-motif').value = motifPropose(o);
  const projets = d.projets.filter((p) => !p.archive || p.id === o.projet);
  $('fiche-projet').innerHTML = `<option value="">Aucun</option>` + projets.map((p) => `<option value="${echapper(p.id)}">${echapper(p.nom)}</option>`).join('');
  $('fiche-projet').value = o.projet || '';
  $('fiche-technique').hidden = !moi?.admin;
  $('fiche-technique').open = false;
  $('fiche-brut').textContent = 'Chargement…';
  $('fiche').showModal();
}
$('fiche-technique').addEventListener('toggle', async () => {
  if (!$('fiche-technique').open || !ficheOp) return;
  try {
    const { brut } = await api(`/api/operations/${encodeURIComponent(ficheOp.id)}`);
    $('fiche-brut').textContent = JSON.stringify(brut, null, 2);
  } catch (e) { $('fiche-brut').textContent = e.message; }
});
$('fiche-categories').addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  ficheCat = b.dataset.c;
  $('fiche-categories').querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.c === ficheCat)));
  $('fiche-regle').hidden = ficheCat === ficheOp.cat || !$('fiche-motif').value;
});
$('fiche').addEventListener('close', async () => {
  if ($('fiche').returnValue !== 'ok' || !ficheOp) return;
  const o = ficheOp;
  const corps = {};
  if (ficheCat !== o.cat) corps.categorie = ficheCat;
  const projet = $('fiche-projet').value;
  if (projet !== (o.projet || '')) corps.projet = projet || (o.projet ? '' : null);
  try {
    const regle = !$('fiche-regle').hidden && $('fiche-toujours').checked && $('fiche-motif').value.trim().length >= 3;
    if (regle) {
      await api('/api/regles', { method: 'POST', body: JSON.stringify({ motif: $('fiche-motif').value, categorie: ficheCat }) });
      // Avec une règle, l'opération suit la règle : pas besoin de choix manuel.
      if ('categorie' in corps) corps.categorie = null;
    }
    if (Object.keys(corps).length) await api(`/api/operations/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: JSON.stringify(corps) });
    await charger();
  } catch (e) {
    alert(e.message);
  }
});

// ---------- navigation ----------
document.querySelectorAll('.onglets button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.page === 'operations') filtre = 'toutes';
  afficherPage(b.dataset.page);
}));
function afficherPage(nom) {
  document.querySelectorAll('.onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.page === nom));
  for (const p of ['accueil', 'operations', 'reglages']) $(`page-${p}`).hidden = nom !== p;
  scrollTo(0, 0);
  if (nom === 'operations' && donnees?.categories) dessinerOperations(donnees, calcul);
  if (nom === 'reglages') dessinerReglages();
}

// ---------- réglages ----------
const TYPES = [['enveloppe', 'Dépense courante'], ['fixe', 'Charge fixe'], ['suivi', 'Sans budget'], ['hors', 'Hors budget']];
const enEuros = (c) => (c ? String(Math.round(c / 100)) : '0');
const enCentimesSaisis = (v) => Math.round(Number(String(v).replace(',', '.')) * 100) || 0;

async function dessinerReglages() {
  const d = donnees || { connexions: [], comptes: [], categories: [], regles: [], projets: [] };

  // Règles personnelles
  const perso = (d.regles || []).filter((r) => r.source === 'perso');
  $('liste-regles').innerHTML = perso.map((r) => `<li><div>${echapper(r.motif)}<small>→ ${echapper(nomCategorie(d, r.categorie))}</small></div>
    <button class="action danger" data-regle="${echapper(r.id)}">Supprimer</button></li>`).join('') || '<li class="vide">Aucune règle personnelle pour l’instant.</li>';

  if (!moi?.admin) return;
  if (!$('liste-categories').dataset.modifie) dessinerCategories(d);
  dessinerProjets(d);

  // Comptes
  $('liste-comptes').innerHTML = d.comptes.map((c) => `<li class="compte-reglage" data-compte="${echapper(c.id)}"><div>
      <input class="compte-nom" value="${echapper(c.nom)}" aria-label="Nom du compte" maxlength="40">
      <small>${echapper(c.banque)}${c.iban ? ` · ${echapper(c.iban)}` : ''}</small>
      <div class="deux">
        <select class="compte-type" aria-label="Type">${[['courant', 'Compte courant'], ['epargne', 'Épargne']]
          .map(([v, t]) => `<option value="${v}" ${c.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>
      <label class="case"><input type="checkbox" class="compte-masque" ${c.masque ? 'checked' : ''}> Masquer ce compte</label>
    </div></li>`).join('') || '<li class="vide">Aucun compte.</li>';

  // Cartes (repérées par la fin de leur numéro dans les libellés)
  $('liste-cartes').innerHTML = (d.cartes || []).map((c) => `<li><div class="ligne-carte">
      <span>Carte …${echapper(c)}</span>
      <input data-carte="${echapper(c)}" value="${echapper(d.nomsCartes?.[c] || '')}" placeholder="Prénom" maxlength="30" aria-label="Titulaire de la carte …${echapper(c)}">
    </div></li>`).join('') || '<li class="vide">Aucun paiement par carte pour l’instant.</li>';

  // Banque
  $('connexions').innerHTML = d.connexions.map((c) => {
    const n = d.comptes.filter((x) => x.connexion === c.id).length;
    const etat = c.statut === 'active' ? (c.expire ? `accès valable jusqu’au ${dateCourte(c.expire)}` : 'accès actif') : 'accès expiré';
    return `<li><div>${echapper(c.banque)}<small>${n} compte(s) · ${etat}</small></div>
      <span><button class="action" data-renouveler="${echapper(c.id)}">Renouveler</button>
      <button class="action danger" data-retirer="${echapper(c.id)}">Retirer</button></span></li>`;
  }).join('') || '<li class="vide">Aucune banque connectée.</li>';

  try {
    const { appareils } = await api('/api/appareils');
    $('appareils').innerHTML = appareils.map((a) => `<li><div>${echapper(a.nom)}${a.moi ? ' (ce téléphone)' : ''}
      <small>${a.admin ? 'administrateur · ' : ''}vu ${depuis(a.vu)}</small></div>
      ${a.moi ? '' : `<button class="action danger" data-appareil="${echapper(a.id)}">Retirer</button>`}</li>`).join('');
  } catch (e) {
    $('appareils').innerHTML = `<li class="vide">${echapper(e.message)}</li>`;
  }
}

$('liste-regles').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-regle]');
  if (!b) return;
  await api(`/api/regles/${encodeURIComponent(b.dataset.regle)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  await charger();
});

// Budgets (catégories)
function dessinerCategories(d) {
  delete $('liste-categories').dataset.modifie;
  $('liste-categories').innerHTML = d.categories.map((c) => ligneCategorie(c)).join('');
}
function ligneCategorie(c) {
  return `<div class="ligne-categorie" data-id="${echapper(c.id || '')}">
    <input class="cat-nom" value="${echapper(c.nom)}" aria-label="Nom" maxlength="40" placeholder="Nom">
    <div class="deux">
      <select class="cat-type" aria-label="Type">${TYPES.map(([v, t]) => `<option value="${v}" ${c.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="cat-budget-l"><input class="cat-budget" type="number" inputmode="decimal" min="0" step="1" value="${enEuros(c.budget)}" aria-label="Budget mensuel en euros"> €/mois</label>
    </div>
    <button type="button" class="action danger cat-suppr">Supprimer</button></div>`;
}
$('liste-categories').addEventListener('input', () => { $('liste-categories').dataset.modifie = '1'; });
$('liste-categories').addEventListener('click', (e) => {
  if (!e.target.classList.contains('cat-suppr')) return;
  const ligne = e.target.closest('.ligne-categorie');
  if (!confirm(`Supprimer « ${ligne.querySelector('.cat-nom').value} » ? Ses opérations repasseront « à classer ».`)) return;
  ligne.remove();
  $('liste-categories').dataset.modifie = '1';
});
$('btn-ajout-categorie').addEventListener('click', () => {
  $('liste-categories').insertAdjacentHTML('beforeend', ligneCategorie({ nom: '', type: 'enveloppe', budget: 0 }));
  $('liste-categories').dataset.modifie = '1';
  $('liste-categories').lastElementChild.querySelector('.cat-nom').focus();
});
$('btn-enregistrer-categories').addEventListener('click', async () => {
  const categories = [...document.querySelectorAll('.ligne-categorie')].map((l) => ({
    id: l.dataset.id || undefined,
    nom: l.querySelector('.cat-nom').value.trim(),
    type: l.querySelector('.cat-type').value,
    budget: enCentimesSaisis(l.querySelector('.cat-budget').value),
  })).filter((c) => c.nom);
  try {
    await api('/api/categories', { method: 'PUT', body: JSON.stringify({ categories }) });
    delete $('liste-categories').dataset.modifie;
    await charger();
    dessinerCategories(donnees);
    statut('Budgets enregistrés ✓');
  } catch (e) { alert(e.message); }
});

// Projets
function dessinerProjets(d) {
  $('liste-projets').innerHTML = d.projets.map((p) => `<li><div>${echapper(p.nom)}${p.archive ? ' <small class="inline">(archivé)</small>' : ''}
    <small>${periode(p)} · ${fmt(p.depense)} / ${fmt(p.budget)} · ${p.nombre} opération(s)${p.motif ? ` · auto : ${echapper(p.motif)}` : ''}</small></div>
    <button class="action" data-projet="${echapper(p.id)}">Modifier</button></li>`).join('') || '<li class="vide">Aucun projet.</li>';
}
function ouvrirProjet(p) {
  $('form-projet').hidden = false;
  $('btn-nouveau-projet').hidden = true;
  $('projet-id').value = p?.id || '';
  $('projet-nom').value = p?.nom || '';
  $('projet-budget').value = p ? enEuros(p.budget) : '';
  $('projet-debut').value = p?.debut || moisCourant();
  $('projet-fin').value = p?.fin || moisCourant();
  $('projet-motif').value = p?.motif || '';
  $('projet-archive').checked = !!p?.archive;
  $('btn-supprimer-projet').hidden = !p;
  $('projet-nom').focus();
}
function fermerProjet() { $('form-projet').hidden = true; $('btn-nouveau-projet').hidden = false; }
$('btn-nouveau-projet').addEventListener('click', () => ouvrirProjet(null));
$('liste-projets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-projet]');
  if (b) ouvrirProjet(donnees.projets.find((p) => p.id === b.dataset.projet));
});
$('form-projet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('projet-id').value;
  const corps = {
    nom: $('projet-nom').value, budget: enCentimesSaisis($('projet-budget').value),
    debut: $('projet-debut').value, fin: $('projet-fin').value, motif: $('projet-motif').value, archive: $('projet-archive').checked,
  };
  try {
    await api(id ? `/api/projets/${encodeURIComponent(id)}` : '/api/projets', { method: id ? 'PUT' : 'POST', body: JSON.stringify(corps) });
    fermerProjet();
    await charger();
  } catch (err) { alert(err.message); }
});
$('btn-supprimer-projet').addEventListener('click', async () => {
  if (!confirm('Supprimer ce projet ? Ses opérations reviendront dans les budgets du mois.')) return;
  await api(`/api/projets/${encodeURIComponent($('projet-id').value)}`, { method: 'DELETE' }).catch((e) => alert(e.message));
  fermerProjet();
  await charger();
});

// Comptes : enregistrement à chaque modification
$('liste-comptes').addEventListener('change', async (e) => {
  const li = e.target.closest('[data-compte]');
  if (!li) return;
  const type = li.querySelector('.compte-type').value;
  try {
    await api(`/api/comptes/${encodeURIComponent(li.dataset.compte)}`, {
      method: 'PATCH',
      body: JSON.stringify({ type, masque: li.querySelector('.compte-masque').checked, nom: li.querySelector('.compte-nom').value }),
    });
    await charger();
  } catch (err) { alert(err.message); }
});

$('liste-cartes').addEventListener('change', async () => {
  const noms = Object.fromEntries([...document.querySelectorAll('[data-carte]')].map((i) => [i.dataset.carte, i.value]));
  try { await api('/api/cartes', { method: 'PUT', body: JSON.stringify({ noms }) }); await charger(); } catch (e) { alert(e.message); }
});

// Banque
$('connexions').addEventListener('click', async (e) => {
  const d = donnees;
  const ren = e.target.closest('[data-renouveler]');
  if (ren) return renouveler(d.connexions.find((c) => c.id === ren.dataset.renouveler));
  const ret = e.target.closest('[data-retirer]');
  if (!ret || !confirm('Retirer cette banque ? Ses comptes et opérations seront effacés de Budget.')) return;
  await api(`/api/connexions/${encodeURIComponent(ret.dataset.retirer)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  await charger();
});
$('appareils').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-appareil]');
  if (!b || !confirm('Retirer l’accès de ce téléphone ?')) return;
  await api(`/api/appareils/${encodeURIComponent(b.dataset.appareil)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  dessinerReglages();
});

let banques = null;
$('btn-connecter').addEventListener('click', async () => {
  $('choix-banque').hidden = false;
  $('btn-connecter').hidden = true;
  $('cherche-banque').focus();
  await chargerBanques();
});
async function chargerBanques() {
  $('banques').innerHTML = '<li class="vide">Chargement de la liste…</li>';
  try {
    banques = (await api(`/api/banques?pays=${$('pays-banque').value}`)).banques;
    listerBanques();
  } catch (e) {
    $('banques').innerHTML = `<li class="vide">${echapper(e.message)}</li>`;
  }
}
const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function listerBanques() {
  if (!banques) return;
  const q = sansAccent($('cherche-banque').value.trim());
  const liste = banques.filter((b) => !q || sansAccent(b.nom).includes(q)).slice(0, 60);
  $('banques').innerHTML = liste.map((b) => `<li><button data-i="${banques.indexOf(b)}">${b.logo ? `<img src="${echapper(b.logo)}" alt="" loading="lazy">` : ''}${echapper(b.nom)}</button></li>`).join('')
    || '<li class="vide">Aucune banque ne correspond.</li>';
}
$('banques').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) connecter(banques[b.dataset.i]); });
$('cherche-banque').addEventListener('input', listerBanques);
$('pays-banque').addEventListener('change', chargerBanques);

async function connecter(banque) {
  statut('Ouverture de la banque…');
  try {
    const { url } = await api('/api/banque/connecter', { method: 'POST', body: JSON.stringify(banque) });
    location.href = url;
  } catch (e) {
    alert(`Connexion impossible : ${e.message}`);
  }
}

async function renouveler(connexion) {
  try {
    const liste = banques || (await api(`/api/banques?pays=${encodeURIComponent(connexion.pays || 'FR')}`)).banques;
    const b = liste.find((x) => x.nom === connexion.banque) || { nom: connexion.banque, pays: connexion.pays };
    await connecter(b);
  } catch (e) {
    alert(`Renouvellement impossible : ${e.message}`);
  }
}

// Invitations
let lienInvitation = null;
$('form-invitation').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/invitations', { method: 'POST', body: JSON.stringify({ nom: $('nom-invite').value }) });
    lienInvitation = r.lien;
    const qr = qrcode(0, 'M');
    qr.addData(r.lien);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    $('code-invitation').textContent = r.code;
    $('expire-invitation').textContent = `Valable jusqu’au ${new Date(r.expire).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.`;
    $('invitation').hidden = false;
    dessinerReglages();
  } catch (err) {
    alert(err.message);
  }
});
$('btn-partager').addEventListener('click', async () => {
  if (!lienInvitation) return;
  const texte = `Voici ton accès à Budget. Ouvre ce lien sur ton téléphone (dans Safari sur iPhone) : ${lienInvitation}`;
  if (navigator.share) {
    await navigator.share({ title: 'Budget', text: texte }).catch(() => {});
  } else {
    await navigator.clipboard?.writeText(lienInvitation).catch(() => {});
    alert('Lien copié.');
  }
});

$('btn-deconnexion').addEventListener('click', async () => {
  if (!confirm('Désactiver ce téléphone ? Il faudra un nouveau code pour y revenir.')) return;
  await api('/api/deconnexion', { method: 'POST' }).catch(() => {});
  try { localStorage.clear(); } catch { /* rien */ }
  location.href = '/';
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
demarrer();
