import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import "./LegalNotice.css";

const PUBLISHER = "Théo Vanbandon";
const CONTACT_EMAIL = "theo.vanbandon@gmail.com";
const LAST_UPDATE = "6 novembre 2026";

/**
 * Mentions légales (LCEN), sources des données, avertissement et données personnelles
 */
export default function LegalNotice({ onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="legal-backdrop" onClick={onClose} role="presentation">
      <div
        className="legal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="legal-header">
          <h2 id="legal-title">Mentions légales</h2>
          <button ref={closeRef} type="button" className="legal-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <section>
          <h3>Éditeur</h3>
          <p>
            Site personnel, édité à titre non professionnel par {PUBLISHER}, responsable de la publication.
            <br />
            Contact : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <section>
          <h3>Hébergement</h3>
          <p>
            Render Inc. - 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis.
            <br />
            Contact : <a href="mailto:support@render.com">support@render.com</a> -{" "}
            <a href="https://render.com" target="_blank" rel="noreferrer">
              render.com
            </a>
          </p>
        </section>

        <section>
          <h3>Sources des données</h3>
          <ul>
            <li>
              Réseau routier et altitudes : IGN - BD TOPO®, via la Géoplateforme, sous Licence Ouverte Etalab 2.0.
              Données consultées à chaque génération (conservées au plus 7 jours en cache).
            </li>
            <li>Fonds de carte Plan IGN et photographies aériennes : IGN - Géoplateforme.</li>
            <li>Communes : API Découpage administratif (geo.api.gouv.fr), sous Licence Ouverte.</li>
            <li>
              Fond OpenStreetMap et géocodage de secours (Nominatim) : © contributeurs OpenStreetMap, sous licence ODbL.
            </li>
            <li>Affichage cartographique : Leaflet.</li>
          </ul>
          <p>Les données restent la propriété de leurs producteurs et sont utilisées dans le respect de leurs licences.</p>
        </section>

        <section>
          <h3>Avertissement et responsabilité</h3>
          <ul>
            <li>
              Les tracés, roadbooks, statistiques et exports sont générés automatiquement à partir de données publiques,
              à titre purement indicatif. Ils peuvent être inexacts ou obsolètes : route fermée, privée ou modifiée, état
              de la chaussée, signalisation, restrictions de circulation…
            </li>
            <li>
              Ils ne constituent ni une autorisation ni une validation. L'organisation d'une épreuve sur la voie publique
              est soumise aux autorisations et déclarations prévues par le Code du sport (préfecture, communes,
              fédération compétente).
            </li>
            <li>
              Lors de tout repérage sur route ouverte, le Code de la route s'applique intégralement. Ne roulez jamais à
              allure de course sur la voie publique.
            </li>
            <li>
              L'utilisateur est seul responsable de la vérification des informations sur le terrain et de l'usage qu'il
              en fait. L'éditeur ne saurait être tenu responsable des conséquences de leur utilisation.
            </li>
          </ul>
        </section>

        <section>
          <h3>Données personnelles et cookies</h3>
          <ul>
            <li>Aucun compte, aucun cookie, aucun outil de mesure d'audience.</li>
            <li>
              La commune et les options choisies sont envoyées au serveur pour générer les spéciales ; elles ne sont
              associées à aucune donnée personnelle et rien n'est conservé à votre sujet.
            </li>
            <li>
              Pour afficher la carte et proposer les communes, votre navigateur interroge directement des services
              publics tiers (IGN Géoplateforme, geo.api.gouv.fr, OpenStreetMap).
            </li>
            <li>
              Pour toute question ou demande, écrivez à <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </li>
          </ul>
        </section>

        <p className="legal-update">Dernière mise à jour : {LAST_UPDATE}</p>
      </div>
    </div>
  );
}

LegalNotice.propTypes = {
  onClose: PropTypes.func.isRequired,
};
