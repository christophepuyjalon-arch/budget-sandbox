# Budget : comptes et enveloppes sur vos téléphones

Budget récupère automatiquement les opérations de vos comptes bancaires (via Enable Banking) et les affiche sur vos téléphones : soldes, opérations du mois, entrées et sorties.

À venir : enveloppes par catégorie avec anneaux « où j’en suis aujourd’hui », puis prévision du solde jusqu’à la fin du mois.

## Comment c’est organisé

Comme pour Forme, un petit serveur gratuit chez Cloudflare garde tes clés secrètes et interroge la banque 2 fois par jour, matin et soir (les banques autorisent 4 consultations par jour sans toi). Les données sont rangées dans une base Cloudflare D1.

```
src/index.js       le serveur : routes, synchronisation, données pour l’app
src/banque.js      le dialogue avec Enable Banking (signature, comptes, opérations)
src/acces.js       qui a le droit d’ouvrir l’app (activation, invitations)
migrations/        la structure de la base de données
public/            l’app (page, styles, icônes, mode hors ligne)
wrangler.toml      la configuration Cloudflare
```

**Pas de mot de passe.** Chaque téléphone est activé une seule fois, puis il reste reconnu. Toi, tu actives le tien avec le code d’installation. Ensuite, tu invites les autres depuis Réglages avec un QR code ou un lien.

## Ce qu’il te faut

- Un ordinateur avec **Node.js 20 ou plus récent** (déjà installé pour Forme).
- Ton **compte Cloudflare** (le même que pour Forme).
- Ton application **Enable Banking** : son identifiant (déjà dans `wrangler.toml`) et le fichier `.pem` de sa clé privée.

## Installation (une seule fois, environ 15 minutes)

Ouvre un terminal dans le dossier `budget-sandbox`, puis tape les commandes une par une.

**1. Installer l’outil Cloudflare**
```
npm install
```

**2. Te connecter à Cloudflare** (inutile si tu l’as déjà fait pour Forme sur cet ordinateur)
```
npx wrangler login
```

**3. Créer la base de données**
```
npx wrangler d1 create budget
```
La commande affiche un `database_id`. Ouvre `wrangler.toml` et remplace `REMPLACE_MOI` par cet id.

**4. Enregistrer tes secrets**

La clé privée Enable Banking, lue directement depuis le fichier `.pem` (remplace le chemin par celui de ton fichier) :

- sur Mac ou Linux :
  ```
  npx wrangler secret put EB_PRIVATE_KEY < /chemin/vers/ta-cle.pem
  ```
- sur Windows (PowerShell) :
  ```
  Get-Content C:\chemin\vers\ta-cle.pem -Raw | npx wrangler secret put EB_PRIVATE_KEY
  ```

Puis le code d’installation (la commande te demande de le taper) :
```
npx wrangler secret put CODE_INSTALLATION
```
Invente une longue phrase de passe (au moins 20 caractères). Elle sert seulement à activer un téléphone **administrateur** : le tien. Garde-la dans ton gestionnaire de mots de passe.

**5. Mettre en ligne** (crée les tables de la base, puis publie l’app)
```
npm run deploy
```
La commande affiche ton adresse, du type `https://budget.ton-compte.workers.dev`.

**6. Déclarer l’adresse chez Enable Banking**

Dans le Control Panel Enable Banking, ajoute à ton application la Redirect URL :
```
https://budget.ton-compte.workers.dev/callback
```
(avec ta vraie adresse). Elle doit être identique au caractère près.

## Sur ton téléphone (Android)

1. Ouvre l’adresse dans **Chrome**.
2. Saisis le code d’installation et ton prénom, puis **Activer**.
3. Touche **Installer l’application** (ou menu ⋮, puis « Installer l’application »).
4. Dans **Réglages**, puis **Connecter une banque** : choisis ta banque et donne ton accord sur son site. Tu reviens ensuite dans l’app avec tes comptes.

## Inviter ta femme (iPhone)

1. Sur ton téléphone : **Réglages**, puis **Famille**. Tape son prénom, puis **Inviter**.
2. Elle scanne le QR code avec l’**appareil photo** de son iPhone. Le lien s’ouvre dans Safari.
3. Elle touche **Activer ce téléphone**, puis suit les 3 étapes affichées pour mettre Budget sur l’écran d’accueil.

L’invitation reste valable 48 heures. Si l’app installée lui redemande un code, elle saisit le code de secours affiché sous le QR code. Si elle change de téléphone, refais une invitation. Pour couper un accès : Réglages, Famille, **Retirer**.

## Entretien

- **Autorisation bancaire expirée** (tous les 90 à 180 jours, selon la banque) : l’app affiche un bandeau. Touche **Renouveler** et redonne ton accord sur le site de la banque. L’historique est conservé.
- **Voir ce qui se passe sur le serveur** : `npx wrangler tail`, puis touche le bouton de synchronisation dans l’app.
- **Modifier le code** : après chaque changement, `npm run deploy`.
- **Tester sur l’ordinateur** : copie `.dev.vars.example` en `.dev.vars`, remplis-le, puis lance `npx wrangler d1 migrations apply budget --local` et `npm run dev`. L’app tourne alors sur `https://localhost:8787`, la Redirect URL déjà déclarée chez Enable Banking.

## Limites connues

- Les opérations arrivent avec le délai de la banque : 2 synchros automatiques par jour, plus le bouton de synchronisation quand tu ouvres l’app.
- Le code Enable Banking a été écrit sans pouvoir consulter leur documentation en direct, puis testé contre une imitation de leur service. Le premier essai sur le sandbox réel peut révéler un nom de champ différent : `npx wrangler tail` affiche alors la réponse exacte de leur serveur.
- À la première connexion, l’app demande 1 an d’historique. Si la banque refuse, elle se contente de 89 jours.
