import { Controller, Get, Headers, Res } from "@nestjs/common";
import { Response } from "express";
import { chargerConfig } from "../config/interop.config";

const VERSION = process.env.npm_package_version ?? "0.2.0";
const SITE = process.env.SITE_URL?.split(",")[0]?.trim() ?? "http://localhost:3030";

/**
 * Racine et sonde de disponibilité — les deux seules routes non authentifiées.
 *
 * La racine sert de point de découverte : un développeur qui reçoit l'URL de
 * l'API doit pouvoir comprendre à quoi il a affaire et où obtenir une clé,
 * sans lire de documentation au préalable. C'est aussi ce qui évite qu'une
 * visite au navigateur ne tombe sur un 404 laissant croire à une panne.
 */
@Controller()
export class HealthController {
  /**
   * GET / — présentation de l'API.
   *
   * Répond en HTML si la requête vient d'un navigateur, en JSON sinon. Un
   * développeur en curl veut un contrat lisible par sa machine ; un curieux
   * qui colle l'URL dans sa barre d'adresse veut savoir où il est tombé.
   */
  @Get()
  racine(
    @Res({ passthrough: true }) res: Response,
    @Headers("accept") accept?: string,
  ) {
    res.setHeader("Cache-Control", "public, max-age=300");

    if (accept?.includes("text/html")) {
      // Sans cet en-tête, Nest renverrait la page en text/plain et le
      // navigateur afficherait le code source au lieu de la page.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return this.pageHtml();
    }
    return this.descriptionJson();
  }

  /**
   * Sonde de disponibilité.
   *
   * N'expose plus les URL des systèmes aval : ce sont des adresses internes
   * d'hôpitaux, et les publier renseignerait sur la topologie du réseau sans
   * rendre service à personne. Elles restent visibles en développement, où
   * elles servent au diagnostic.
   */
  @Get("health")
  health() {
    const enDeveloppement = process.env.NODE_ENV !== "production";
    const c = chargerConfig();

    return {
      service: "allsante-api",
      version: VERSION,
      statut: "ok",
      horodatage: new Date().toISOString(),
      ...(enDeveloppement
        ? {
            avalDeveloppement: {
              dpi: c.dpi.url,
              openelis: c.openelis.url,
            },
          }
        : {}),
    };
  }

  // ─── Contenus ──────────────────────────────────────────────────────────────

  private descriptionJson() {
    return {
      service: "All_Santé",
      version: VERSION,
      description:
        "Plateforme d'interopérabilité en santé : bus FHIR R4 et dépôt national " +
        "d'identité et d'historique clinique, articulés autour du matricule CMU.",
      documentation: `${SITE}/docs`,
      portailDeveloppeur: `${SITE}/portail`,
      authentification: {
        entete: "x-api-key",
        obtention: `${SITE}/portail`,
        note:
          "Chaque établissement dispose de sa propre clé. Elle identifie " +
          "l'appelant : aucun en-tête déclaratif n'est nécessaire.",
      },
      endpoints: {
        depotNational: {
          "GET  /national/patients/:matricule":
            "Identité pivot d'un patient (13 chiffres)",
          "GET  /national/patients/:matricule/consultations":
            "Historique clinique consolidé",
          "GET  /national/patients/:matricule/socle-vital":
            "Groupe sanguin, allergies, traitements au long cours",
          "POST /national/patients": "Publication d'identité",
          "POST /national/consultations":
            "Publication d'un épisode de soin (consentement requis)",
        },
        busFhir: {
          "POST /interop/fhir/prise-en-charge": "SGCH → DPI",
          "POST /interop/fhir/demande-examen": "DPI → laboratoire",
          "POST /interop/fhir/resultats": "Laboratoire → DPI",
        },
        public: {
          "GET /": "Cette description",
          "GET /health": "Sonde de disponibilité",
        },
      },
      principes: [
        "Aucune donnée clinique n'est publiée sans consentement du patient.",
        "Chaque accès au dépôt national est journalisé et opposable.",
        "Seul un diagnostic validé par un médecin est partagé, jamais une suggestion d'IA.",
      ],
    };
  }

  private pageHtml() {
    const d = this.descriptionJson();
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>All_Santé — API d'interopérabilité</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#06080d; color:#e6ebf4;
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:64px 24px; }
  .badge { display:inline-block; border:1px solid #2a3547; background:#0e131d;
           border-radius:999px; padding:4px 12px; font-size:12px; color:#97a3b6; }
  h1 { font-size:32px; margin:20px 0 8px; letter-spacing:-.02em; }
  h1 span { color:#2dd4bf; }
  p.lead { color:#97a3b6; margin:0 0 32px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.08em;
       color:#63708a; margin:36px 0 12px; font-weight:600; }
  .card { border:1px solid #1c2432; background:#0e131d; border-radius:14px;
          padding:18px 20px; margin-bottom:12px; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; }
  .ep { display:flex; gap:12px; padding:6px 0; flex-wrap:wrap; }
  .ep code { color:#2dd4bf; white-space:nowrap; }
  .ep span { color:#97a3b6; font-size:14px; }
  a { color:#38bdf8; }
  ul { padding-left:18px; color:#97a3b6; }
  footer { margin-top:40px; padding-top:20px; border-top:1px solid #1c2432;
           color:#63708a; font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <span class="badge">API · v${d.version}</span>
  <h1>All<span>_</span>Santé</h1>
  <p class="lead">${d.description}</p>

  <div class="card">
    <strong>Vous cherchez une clé d'accès&nbsp;?</strong><br>
    Inscrivez votre établissement sur le
    <a href="${d.portailDeveloppeur}">portail développeur</a>, puis générez
    votre clé. Elle s'envoie dans l'en-tête <code>x-api-key</code> et identifie
    votre établissement à chaque appel.
  </div>

  <h2>Dépôt national</h2>
  <div class="card">
    ${Object.entries(d.endpoints.depotNational)
      .map(([k, v]) => `<div class="ep"><code>${k}</code><span>${v}</span></div>`)
      .join("")}
  </div>

  <h2>Bus d'interopérabilité FHIR</h2>
  <div class="card">
    ${Object.entries(d.endpoints.busFhir)
      .map(([k, v]) => `<div class="ep"><code>${k}</code><span>${v}</span></div>`)
      .join("")}
  </div>

  <h2>Principes</h2>
  <div class="card">
    <ul>${d.principes.map((p) => `<li>${p}</li>`).join("")}</ul>
  </div>

  <footer>
    <a href="${d.documentation}">Documentation</a> ·
    <a href="/health">État du service</a> ·
    Projet de fin de cycle — KRA Mardochée, ESATIC (Abidjan)
  </footer>
</div>
</body>
</html>`;
  }
}
