// ============================================================================
// Seed du dépôt national All_Santé (base allsante_global)
//
//   npm run seed:national
//
// Jeu de démonstration pour la soutenance : deux établissements affiliés et
// quatre patients dont l'historique a été produit à l'Hôpital B. Quand ces
// patients se présentent à l'Hôpital A, SGCH doit les reconnaître au matricule
// et le DPI doit afficher leur historique externe.
//
// Le script est IDEMPOTENT : on peut le rejouer autant de fois que nécessaire.
// ============================================================================

import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Les clés API ne sont jamais stockées en clair. */
const hacher = (cle: string) => createHash("sha256").update(cle).digest("hex");

// Une seule clé de seed : celle de l'hôpital DISTANT.
//
// Votre propre établissement ne doit PAS être créé ici. Vous l'inscrivez
// depuis le portail développeur, ce qui vous donne une vraie clé et un vrai
// compte. Deux « hôpital A » — un semé, un inscrit — c'était la source de
// confusion : deux codes, deux clés, et des .env qui ne savaient plus lequel
// désigner.
const CLES = {
  "CHU-B": "cle-chu-b-dev-0002",
} as const;

// Chaque établissement déclare SES systèmes : c'est ce qui permet au bus de
// renvoyer un Bundle à son émetteur. Sans ces adresses, il retombe sur la
// cible globale de sa configuration — donc vers un AUTRE hôpital dès qu'il y
// en a plus d'un.
const ETABLISSEMENTS = [
  {
    code: "CHU-B",
    nom: "CHR de Bouaké",
    type: "CHR" as const,
    ville: "Bouaké",
    contactEmail: "interop@chr-bouake.ci",
    contactTel: "2731635678",
    dpiUrl: "http://localhost:3101",
    openelisUrl: "http://localhost:3121",
    cleSortante: "allsante-vers-systemes-B-a-changer",
  },
];

// ─── Patients de démonstration ───────────────────────────────────────────────
// Matricules à 13 chiffres, format retenu : AAAAMMJJSSSSS (naissance + série).

const PATIENTS = [
  {
    matricule: "1994031200123",
    nom: "KOUASSI",
    prenom: "Aya",
    genre: "feminin" as const,
    dateNaissance: "1994-03-12",
    contact: "0707010203",
    email: "aya.kouassi@example.ci",
    adresse: "Quartier Air France, rue 12",
    villeCommune: "Bouaké",
    nationalite: "Ivoirienne",
    profession: "Commerçante",
    situationMatrimoniale: "Mariée",
    groupeSanguin: "O+",
    assuranceNom: "CMU",
    assuranceNumero: "CMU-1994031200123",
    origine: "CHU-B",
  },
  {
    matricule: "1987112400456",
    nom: "DIABATÉ",
    prenom: "Moussa",
    genre: "masculin" as const,
    dateNaissance: "1987-11-24",
    contact: "0505060708",
    adresse: "Belleville, lot 43",
    villeCommune: "Bouaké",
    nationalite: "Ivoirienne",
    profession: "Chauffeur",
    situationMatrimoniale: "Marié",
    groupeSanguin: "A+",
    assuranceNom: "CMU",
    assuranceNumero: "CMU-1987112400456",
    origine: "CHU-B",
  },
  {
    matricule: "2001060500789",
    nom: "N’GUESSAN",
    prenom: "Affoué",
    genre: "feminin" as const,
    dateNaissance: "2001-06-05",
    contact: "0102030405",
    villeCommune: "Yamoussoukro",
    nationalite: "Ivoirienne",
    profession: "Étudiante",
    situationMatrimoniale: "Célibataire",
    groupeSanguin: "B+",
    assuranceNom: "MUGEFCI",
    assuranceNumero: "MUG-2001060500789",
    origine: "CHU-B",
  },
  {
    matricule: "1976022900321",
    nom: "BAMBA",
    prenom: "Ibrahim",
    genre: "masculin" as const,
    dateNaissance: "1976-02-29",
    contact: "0908070605",
    villeCommune: "Korhogo",
    nationalite: "Ivoirienne",
    profession: "Agriculteur",
    situationMatrimoniale: "Marié",
    groupeSanguin: "AB+",
    assuranceNom: "Aucune",
    origine: "CHU-B",
  },
];

/** Date relative à aujourd'hui, pour que la démo reste toujours « récente ». */
const ilYA = (jours: number) =>
  new Date(Date.now() - jours * 24 * 60 * 60 * 1000);

const CONSULTATIONS = [
  // ── Aya KOUASSI — le cas vedette de la démonstration ──────────────────────
  {
    matricule: "1994031200123",
    etablissement: "CHU-B",
    referenceLocale: "CONS-B-2026-0417",
    dateConsultation: ilYA(96),
    motif: "Fièvre persistante depuis 4 jours, céphalées et frissons",
    professionnel: "Dr. TRAORÉ Salif",
    specialite: "Médecine générale",
    typeVisite: "Consultation externe",
    diagnosticRetenu: "Paludisme simple à Plasmodium falciparum",
    codeCim10: "B50.9",
    syntheseClinique:
      "Accès palustre simple confirmé par goutte épaisse. Pas de signe de gravité. Évolution favorable sous CTA, apyrexie à J3.",
    conduiteATenir:
      "Traitement antipaludique complet, contrôle à J7 si persistance de la fièvre.",
    prescriptions: [
      {
        medicament: "Artéméther-Luméfantrine 20/120 mg",
        dci: "Artéméther + Luméfantrine",
        dosage: "4 comprimés",
        posologie: "4 cp matin et soir",
        voie: "Orale",
        dureeJours: 3,
        instructions: "À prendre au cours d’un repas gras.",
      },
      {
        medicament: "Paracétamol 500 mg",
        dci: "Paracétamol",
        dosage: "1 g",
        posologie: "1 g x 3/jour si fièvre",
        voie: "Orale",
        dureeJours: 5,
        instructions: "Ne pas dépasser 3 g par jour.",
      },
    ],
    resultats: [
      {
        libelle: "Goutte épaisse / frottis sanguin",
        categorie: "Parasitologie",
        valeur: "Positif — 2 400 trophozoïtes/µL",
        interpretation: "Parasitémie modérée à P. falciparum",
        anormal: true,
        dateResultat: ilYA(96),
      },
      {
        libelle: "Hémoglobine",
        categorie: "Hématologie",
        valeur: "10.8",
        unite: "g/dL",
        valeurNormale: "12 – 16 g/dL",
        interpretation: "Anémie légère",
        anormal: true,
        dateResultat: ilYA(96),
      },
    ],
  },
  {
    matricule: "1994031200123",
    etablissement: "CHU-B",
    referenceLocale: "CONS-B-2026-0511",
    dateConsultation: ilYA(41),
    motif: "Contrôle post-paludisme et asthénie persistante",
    professionnel: "Dr. TRAORÉ Salif",
    specialite: "Médecine générale",
    typeVisite: "Consultation de suivi",
    diagnosticRetenu: "Anémie ferriprive modérée",
    codeCim10: "D50.9",
    syntheseClinique:
      "Guérison du paludisme confirmée (goutte épaisse négative). Persistance d’une anémie ferriprive : supplémentation martiale instaurée.",
    conduiteATenir:
      "Fer + acide folique pendant 3 mois, contrôle de la NFS à 3 mois.",
    prescriptions: [
      {
        medicament: "Sulfate ferreux + acide folique",
        dci: "Fer + acide folique",
        dosage: "200 mg / 0,4 mg",
        posologie: "1 comprimé par jour",
        voie: "Orale",
        dureeJours: 90,
        instructions: "À distance du thé et du café.",
      },
    ],
    resultats: [
      {
        libelle: "Goutte épaisse (contrôle)",
        categorie: "Parasitologie",
        valeur: "Négatif",
        interpretation: "Guérison parasitologique",
        anormal: false,
        dateResultat: ilYA(41),
      },
      {
        libelle: "Ferritine",
        categorie: "Biochimie",
        valeur: "11",
        unite: "ng/mL",
        valeurNormale: "15 – 150 ng/mL",
        interpretation: "Carence martiale",
        anormal: true,
        dateResultat: ilYA(41),
      },
    ],
  },
  // ── Moussa DIABATÉ ────────────────────────────────────────────────────────
  {
    matricule: "1987112400456",
    etablissement: "CHU-B",
    referenceLocale: "CONS-B-2026-0388",
    dateConsultation: ilYA(150),
    motif:
      "Toux productive depuis 3 semaines, sueurs nocturnes, amaigrissement",
    professionnel: "Dr. KONÉ Awa",
    specialite: "Pneumologie",
    typeVisite: "Consultation externe",
    diagnosticRetenu: "Tuberculose pulmonaire à microscopie positive",
    codeCim10: "A15.0",
    syntheseClinique:
      "TPM+ confirmée. Mise sous traitement antituberculeux catégorie I. Patient sous DOTS, observance à surveiller — élément déterminant si le patient est revu ailleurs.",
    conduiteATenir:
      "Quadrithérapie 2 mois puis bithérapie 4 mois. Contrôle des crachats à M2, M5 et M6.",
    prescriptions: [
      {
        medicament: "RHZE (Rifampicine-Isoniazide-Pyrazinamide-Éthambutol)",
        dci: "Association antituberculeuse",
        dosage: "4 comprimés",
        posologie: "4 cp par jour à jeun",
        voie: "Orale",
        dureeJours: 60,
        instructions: "Phase intensive — ne jamais interrompre le traitement.",
      },
    ],
    resultats: [
      {
        libelle: "Recherche de BAAR (crachats)",
        categorie: "Bactériologie",
        valeur: "Positif (++)",
        interpretation: "Tuberculose pulmonaire bacillifère",
        anormal: true,
        dateResultat: ilYA(151),
      },
      {
        libelle: "Sérologie VIH",
        categorie: "Sérologie",
        valeur: "Négatif",
        anormal: false,
        dateResultat: ilYA(151),
      },
    ],
  },
  // ── Affoué N'GUESSAN ──────────────────────────────────────────────────────
  {
    matricule: "2001060500789",
    etablissement: "CHU-B",
    referenceLocale: "CONS-B-2026-0502",
    dateConsultation: ilYA(58),
    motif: "Douleurs abdominales et fièvre au long cours",
    professionnel: "Dr. YAO Kouadio",
    specialite: "Médecine générale",
    typeVisite: "Consultation externe",
    diagnosticRetenu: "Fièvre typhoïde",
    codeCim10: "A01.0",
    syntheseClinique:
      "Sérologie de Widal et Félix positive. Évolution favorable sous ciprofloxacine.",
    conduiteATenir: "Antibiothérapie 7 jours, hydratation, repos.",
    prescriptions: [
      {
        medicament: "Ciprofloxacine 500 mg",
        dci: "Ciprofloxacine",
        dosage: "500 mg",
        posologie: "1 cp matin et soir",
        voie: "Orale",
        dureeJours: 7,
      },
    ],
    resultats: [
      {
        libelle: "Sérodiagnostic de Widal et Félix",
        categorie: "Sérologie",
        valeur: "TO 1/320 — TH 1/640",
        interpretation: "Compatible avec une fièvre typhoïde évolutive",
        anormal: true,
        dateResultat: ilYA(59),
      },
    ],
  },
  // ── Ibrahim BAMBA ─────────────────────────────────────────────────────────
  {
    matricule: "1976022900321",
    etablissement: "CHU-B",
    referenceLocale: "CONS-B-2026-0466",
    dateConsultation: ilYA(75),
    motif: "Céphalées, vertiges et bourdonnements d’oreille",
    professionnel: "Dr. KONÉ Awa",
    specialite: "Cardiologie",
    typeVisite: "Consultation externe",
    diagnosticRetenu: "Hypertension artérielle essentielle, grade 2",
    codeCim10: "I10",
    syntheseClinique:
      "TA à 168/104 mmHg confirmée sur trois mesures. Pas d’atteinte d’organe cible à ce stade. Traitement de fond instauré — information capitale pour tout prescripteur ultérieur.",
    conduiteATenir:
      "Amlodipine au long cours, régime hyposodé, contrôle tensionnel mensuel.",
    prescriptions: [
      {
        medicament: "Amlodipine 5 mg",
        dci: "Amlodipine",
        dosage: "5 mg",
        posologie: "1 comprimé le matin",
        voie: "Orale",
        dureeJours: 90,
        instructions:
          "Traitement au long cours — ne pas arrêter sans avis médical.",
      },
    ],
    resultats: [
      {
        libelle: "Créatininémie",
        categorie: "Biochimie",
        valeur: "11.2",
        unite: "mg/L",
        valeurNormale: "7 – 13 mg/L",
        anormal: false,
        dateResultat: ilYA(76),
      },
      {
        libelle: "Glycémie à jeun",
        categorie: "Biochimie",
        valeur: "1.02",
        unite: "g/L",
        valeurNormale: "0,70 – 1,10 g/L",
        anormal: false,
        dateResultat: ilYA(76),
      },
    ],
  },
];

// ─── Consultations NON consenties : marqueurs sans aucun contenu ─────────────
//
// C'est la démonstration du modèle : ces lignes existent, mais elles ne
// portent ni date, ni motif, ni diagnostic — rien n'a jamais été écrit.
//
//   • L'étage EPISODE_SOIN fait lever le drapeau « éléments non partagés » :
//     le médecin sait qu'il ne voit pas tout.
//   • L'étage CHARGE_SOCIALE ne le lève PAS : pour ces données, l'existence
//     même d'un secret est une information qui ne doit pas fuir.

const MARQUEURS = [
  {
    matricule: "1994031200123",
    etablissement: "CHU-B",
    referenceLocale: "CONS-B-2026-0489",
    etage: "EPISODE_SOIN" as const,
    recueilliPar: "Dr. TRAORÉ Salif",
  },
  {
    matricule: "2001060500789",
    etablissement: "CHU-B",
    referenceLocale: "CONS-B-2026-0530",
    etage: "CHARGE_SOCIALE" as const,
    recueilliPar: "Dr. YAO Kouadio",
  },
];

// ─── Socle vital ────────────────────────────────────────────────────────────
// Publié par défaut : une allergie à la pénicilline sauve une vie et n'expose
// personne. Volume minuscule, valeur clinique immédiate.

const ALLERGIES = [
  {
    matricule: "1994031200123",
    etablissement: "CHU-B",
    referenceLocale: "ALG-B-0012",
    libelle: "Pénicilline",
    type: "Médicamenteuse",
    severite: "severe",
    reaction: "Œdème de Quincke lors d’une amoxicilline en 2021.",
  },
  {
    matricule: "1987112400456",
    etablissement: "CHU-B",
    referenceLocale: "ALG-B-0027",
    libelle: "Sulfamides",
    type: "Médicamenteuse",
    severite: "moderee",
    reaction: "Éruption cutanée généralisée.",
  },
  {
    matricule: "1976022900321",
    etablissement: "CHU-B",
    referenceLocale: "ALG-B-0035",
    libelle: "Arachide",
    type: "Alimentaire",
    severite: "anaphylaxie",
    reaction: "Choc anaphylactique en 2019, hospitalisation en réanimation.",
  },
];

const TRAITEMENTS = [
  {
    matricule: "1976022900321",
    etablissement: "CHU-B",
    referenceLocale: "TRT-B-0101",
    medicament: "Amlodipine 5 mg",
    dci: "Amlodipine",
    dosage: "5 mg",
    posologie: "1 comprimé le matin",
    indication: "Hypertension artérielle essentielle",
    debutLe: ilYA(75),
  },
  {
    matricule: "1994031200123",
    etablissement: "CHU-B",
    referenceLocale: "TRT-B-0118",
    medicament: "Sulfate ferreux + acide folique",
    dci: "Fer + acide folique",
    dosage: "200 mg / 0,4 mg",
    posologie: "1 comprimé par jour",
    indication: "Anémie ferriprive",
    debutLe: ilYA(41),
  },
  {
    matricule: "1987112400456",
    etablissement: "CHU-B",
    referenceLocale: "TRT-B-0092",
    medicament: "RHZE",
    dci: "Association antituberculeuse",
    dosage: "4 comprimés",
    posologie: "4 cp par jour à jeun",
    indication: "Tuberculose pulmonaire — phase intensive",
    debutLe: ilYA(150),
  },
];

async function main() {
  console.log("── Seed du dépôt national All_Santé ──────────────────────────");

  // 1. Établissements affiliés + leur clé API propre
  //
  // Chaque établissement a SA clé : c'est ce qui permet à la garde de résoudre
  // l'appelant au lieu de le croire sur parole, et donc au journal d'accès
  // d'être opposable.
  const parCode = new Map<string, string>();
  for (const e of ETABLISSEMENTS) {
    const cleEnClair = CLES[e.code as keyof typeof CLES];
    const etablissement = await prisma.etablissementNational.upsert({
      where: { code: e.code },
      create: { ...e, actif: true },
      update: {
        nom: e.nom,
        ville: e.ville,
        actif: true,
        dpiUrl: e.dpiUrl,
        openelisUrl: e.openelisUrl,
        cleSortante: e.cleSortante,
      },
    });
    parCode.set(e.code, etablissement.id);

    const empreinte = hacher(cleEnClair);
    const existante = await prisma.cleApi.findUnique({ where: { empreinte } });
    if (!existante) {
      await prisma.cleApi.create({
        data: {
          etablissementId: etablissement.id,
          libelle: "Clé de développement (seed)",
          empreinte,
          prefixe: cleEnClair.slice(0, 12),
        },
      });
    }

    console.log(`  ✓ établissement ${e.code} — ${e.nom}`);
  }

  // 2. Identités pivots
  for (const p of PATIENTS) {
    const { origine, dateNaissance, ...reste } = p;
    const donnees = {
      ...reste,
      dateNaissance: new Date(dateNaissance),
      etablissementOrigineId: parCode.get(origine) ?? null,
      versionSource: new Date(),
    };
    await prisma.patientNational.upsert({
      where: { matricule: p.matricule },
      create: donnees,
      update: donnees,
    });
    console.log(`  ✓ patient ${p.matricule} — ${p.nom} ${p.prenom ?? ""}`);
  }

  // 3. Consultations publiées par l'Hôpital B
  for (const c of CONSULTATIONS) {
    const patient = await prisma.patientNational.findUniqueOrThrow({
      where: { matricule: c.matricule },
      select: { id: true },
    });
    const etablissementSourceId = parCode.get(c.etablissement);
    if (!etablissementSourceId) continue;

    const cle = {
      etablissementSourceId_referenceLocale: {
        etablissementSourceId,
        referenceLocale: c.referenceLocale,
      },
    };

    // Republication propre : on purge les lignes filles avant de réécrire.
    const existante = await prisma.consultationNationale.findUnique({
      where: cle,
      select: { id: true },
    });
    if (existante) {
      await prisma.prescriptionNationale.deleteMany({
        where: { consultationId: existante.id },
      });
      await prisma.resultatExamenNational.deleteMany({
        where: { consultationId: existante.id },
      });
    }

    const donnees = {
      patientId: patient.id,
      etablissementSourceId,
      referenceLocale: c.referenceLocale,
      partage: true,
      etage: "EPISODE_SOIN" as const,
      dateConsultation: c.dateConsultation,
      motif: c.motif,
      professionnel: c.professionnel,
      specialite: c.specialite ?? null,
      typeVisite: c.typeVisite ?? null,
      statut: "TERMINEE" as const,
      diagnosticRetenu: c.diagnosticRetenu ?? null,
      codeCim10: c.codeCim10 ?? null,
      syntheseClinique: c.syntheseClinique ?? null,
      conduiteATenir: c.conduiteATenir ?? null,
      prescriptions: { create: c.prescriptions ?? [] },
      resultats: { create: c.resultats ?? [] },
    };

    const enregistree = await prisma.consultationNationale.upsert({
      where: cle,
      create: donnees,
      update: donnees,
      select: { id: true },
    });

    // Trace du consentement : sans elle, la publication ne serait pas opposable.
    await prisma.consentementPublication.deleteMany({
      where: { consultationId: enregistree.id },
    });
    await prisma.consentementPublication.create({
      data: {
        patientId: patient.id,
        consultationId: enregistree.id,
        etablissementId: etablissementSourceId,
        accorde: true,
        portee: "CONSULTATION_UNIQUE",
        support: "ORAL_TRACE_DPI",
        etages: ["EPISODE_SOIN"],
        recueilliPar: c.professionnel,
        recueilliLe: c.dateConsultation,
      },
    });

    console.log(
      `  ✓ consultation ${c.referenceLocale} — ${c.diagnosticRetenu ?? c.motif}`,
    );
  }

  // 4. Marqueurs : consultations REFUSÉES par le patient, sans aucun contenu
  for (const m of MARQUEURS) {
    const patient = await prisma.patientNational.findUniqueOrThrow({
      where: { matricule: m.matricule },
      select: { id: true },
    });
    const etablissementSourceId = parCode.get(m.etablissement);
    if (!etablissementSourceId) continue;

    const cle = {
      etablissementSourceId_referenceLocale: {
        etablissementSourceId,
        referenceLocale: m.referenceLocale,
      },
    };

    const donnees = {
      patientId: patient.id,
      etablissementSourceId,
      referenceLocale: m.referenceLocale,
      partage: false,
      etage: m.etage,
      // Tous les champs cliniques restent NULL : rien n'a jamais été écrit.
    };

    const marqueur = await prisma.consultationNationale.upsert({
      where: cle,
      create: donnees,
      update: donnees,
      select: { id: true },
    });

    await prisma.consentementPublication.deleteMany({
      where: { consultationId: marqueur.id },
    });
    await prisma.consentementPublication.create({
      data: {
        patientId: patient.id,
        consultationId: marqueur.id,
        etablissementId: etablissementSourceId,
        accorde: false,
        portee: "CONSULTATION_UNIQUE",
        support: "ORAL_TRACE_DPI",
        etages: [m.etage],
        recueilliPar: m.recueilliPar,
        recueilliLe: new Date(),
      },
    });

    const effet =
      m.etage === "CHARGE_SOCIALE"
        ? "jamais signalé (charge sociale)"
        : "lève le drapeau « éléments non partagés »";
    console.log(
      `  ✓ marqueur ${m.referenceLocale} — refus du patient, ${effet}`,
    );
  }

  // 5. Socle vital : allergies
  for (const a of ALLERGIES) {
    const patient = await prisma.patientNational.findUniqueOrThrow({
      where: { matricule: a.matricule },
      select: { id: true },
    });
    const etablissementSourceId = parCode.get(a.etablissement);
    if (!etablissementSourceId) continue;

    const donnees = {
      patientId: patient.id,
      etablissementSourceId,
      referenceLocale: a.referenceLocale,
      libelle: a.libelle,
      type: a.type ?? null,
      severite: a.severite ?? null,
      reaction: a.reaction ?? null,
      active: true,
    };
    await prisma.allergieNationale.upsert({
      where: {
        etablissementSourceId_referenceLocale: {
          etablissementSourceId,
          referenceLocale: a.referenceLocale,
        },
      },
      create: donnees,
      update: donnees,
    });
    console.log(`  ✓ allergie ${a.libelle} — ${a.matricule}`);
  }

  // 6. Socle vital : traitements au long cours
  for (const t of TRAITEMENTS) {
    const patient = await prisma.patientNational.findUniqueOrThrow({
      where: { matricule: t.matricule },
      select: { id: true },
    });
    const etablissementSourceId = parCode.get(t.etablissement);
    if (!etablissementSourceId) continue;

    const donnees = {
      patientId: patient.id,
      etablissementSourceId,
      referenceLocale: t.referenceLocale,
      medicament: t.medicament,
      dci: t.dci ?? null,
      dosage: t.dosage ?? null,
      posologie: t.posologie ?? null,
      indication: t.indication ?? null,
      debutLe: t.debutLe ?? null,
      actif: true,
    };
    await prisma.traitementChroniqueNational.upsert({
      where: {
        etablissementSourceId_referenceLocale: {
          etablissementSourceId,
          referenceLocale: t.referenceLocale,
        },
      },
      create: donnees,
      update: donnees,
    });
    console.log(`  ✓ traitement chronique ${t.medicament} — ${t.matricule}`);
  }

  const stats = {
    etablissements: await prisma.etablissementNational.count(),
    patients: await prisma.patientNational.count(),
    consultationsPartagees: await prisma.consultationNationale.count({
      where: { partage: true },
    }),
    marqueursNonPartages: await prisma.consultationNationale.count({
      where: { partage: false },
    }),
    consentements: await prisma.consentementPublication.count(),
    allergies: await prisma.allergieNationale.count(),
    traitementsChroniques: await prisma.traitementChroniqueNational.count(),
    prescriptions: await prisma.prescriptionNationale.count(),
    resultats: await prisma.resultatExamenNational.count(),
  };

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Dépôt national peuplé :", stats);
  console.log("");
  console.log("  Un SEUL établissement est semé : CHU-B (hôpital distant).");
  console.log(
    "  Le vôtre s’inscrit depuis le portail → http://localhost:3030/portail",
  );
  console.log("");
  console.log("  Matricule vedette : 1994031200123  (Aya KOUASSI)");
  console.log("    • 2 consultations partagées, produites au CHR de Bouaké");
  console.log(
    "    • 1 consultation REFUSÉE -> drapeau « éléments non partagés »",
  );
  console.log("    • allergie à la pénicilline au socle vital");
  console.log("");
  console.log(
    "  Matricule à charge sociale : 2001060500789  (Affoué N’GUESSAN)",
  );
  console.log("    • 1 refus en étage CHARGE_SOCIALE -> AUCUN signalement");
  console.log("");
  console.log("  Clés API des établissements (développement uniquement) :");
  for (const [code, cle] of Object.entries(CLES)) {
    console.log(`    ${code} → ${cle}`);
  }
  console.log("──────────────────────────────────────────────────────────────");
}

main()
  .catch((err) => {
    console.error("Échec du seed :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
