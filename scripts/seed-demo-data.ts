/**
 * Demo data for the owner's own organizations on DEV and PROD.
 *
 * The owner logs in as tamay@coban.cc and wants that user to own two realistic
 * SHK companies (Berlin and Potsdam) with 10 to 15 employees each and operational
 * data from August to November 2026, on both cloud projects. The data is
 * disposable: nothing here is documented as product behaviour, and the script
 * is meant to grow as features land (add a section, re-run).
 *
 * Usage:
 *   bun scripts/seed-demo-data.ts --target dev
 *   bun scripts/seed-demo-data.ts --target prod --confirm-prod
 *   ... --phase reset   (only delete the owner's organizations)
 *   ... --phase seed    (only create; fails if the demo organizations exist)
 *
 * Reads the gitignored `.env.dev-backup` / `.env.live-backup` directly, so
 * `.env.local` stays untouched. The reset deletes only organizations whose
 * `admin_id` is the owner's user, their R2 objects, and member users that are
 * left without any membership. Willert Haustechnik's organization is refused by
 * id as a second guard; the owner is not a member there.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../lib/supabase/database.types';
import { getPublicHolidaysForYear, type HolidayRegion } from '../lib/personnel/holidays';
import { resolveBerlinWallTime } from '../lib/planning/date-time';
import { deleteStorageObjects, listStorageObjectPaths } from '../lib/storage/r2';

type Tables = Database['public']['Tables'];
type Insert<T extends keyof Tables> = Tables[T]['Insert'];
type Admin = SupabaseClient<Database>;

const OWNER_EMAIL = 'tamay@coban.cc';
const WILLERT_ORGANIZATION_ID = '351e9e05-b8c6-4d5c-b29f-b33b2f1f04de';
const DEMO_PASSWORD = 'WerkFlow-Demo-2026!';
const TODAY = '2026-09-18';
const RANGE_START = '2026-08-03';
const RANGE_END = '2026-11-27';
const ENV_FILES = { dev: '.env.dev-backup', prod: '.env.live-backup' } as const;
const ORGANIZATION_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------------------
// Company specifications
// ---------------------------------------------------------------------------

type Role = Database['public']['Enums']['org_role'];
type Employment = 'vollzeit' | 'teilzeit' | 'ausbildung' | 'minijob';
type TeamKey = 'heizung' | 'sanitaer' | 'service';

type PersonSpec = {
  first: string;
  last: string;
  role: Role;
  title: string;
  employment: Employment;
  weeklyHours: number;
  vacationDays: number;
  entryDate: string;
  field: boolean;
  team: TeamKey | null;
  skills: string[];
  certifications: string[];
};

type CompanySpec = {
  key: string;
  seed: number;
  name: string;
  city: string;
  postalCodes: string[];
  streets: string[];
  region: HolidayRegion;
  emailDomain: string;
  plate: string;
  phonePrefix: string;
  people: PersonSpec[];
};

const BERLIN_STREETS = ['Kantstraße', 'Bergmannstraße', 'Schönhauser Allee', 'Müllerstraße', 'Hauptstraße', 'Karl-Marx-Straße', 'Prenzlauer Allee', 'Wilmersdorfer Straße', 'Rheinstraße', 'Breite Straße', 'Alt-Moabit', 'Frankfurter Allee', 'Bornholmer Straße', 'Grunewaldstraße', 'Residenzstraße'];
const POTSDAM_STREETS = ['Zeppelinstraße', 'Friedrich-Ebert-Straße', 'Breite Straße', 'Am Kanal', 'Berliner Straße', 'Heinrich-Mann-Allee', 'Hegelallee', 'Lindenstraße', 'Kurfürstenstraße', 'Ribbeckstraße', 'Potsdamer Straße', 'Am Neuen Garten', 'Geschwister-Scholl-Straße', 'Nuthestraße', 'Großbeerenstraße'];

const COMPANIES: CompanySpec[] = [
  {
    key: 'kaltenbach',
    seed: 20260801,
    name: 'Kaltenbach Haustechnik GmbH',
    city: 'Berlin',
    postalCodes: ['10115', '10247', '10405', '10589', '10777', '10967', '12043', '12161', '13347', '13409', '14059', '14197'],
    streets: BERLIN_STREETS,
    region: 'BE',
    emailDomain: 'kaltenbach-haustechnik.example.com',
    plate: 'B-KH',
    phonePrefix: '030 55',
    people: [
      { first: 'Jonas', last: 'Kaltenbach', role: 'buero', title: 'Installateur- und Heizungsbauermeister, Betriebsleitung', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2015-06-01', field: false, team: 'heizung', skills: ['Gasinstallation', 'Wärmepumpen', 'Hydraulischer Abgleich'], certifications: ['Gas-Sachkunde (TRGI)', 'Kälteschein Kategorie II'] },
      { first: 'Lena', last: 'Hartmann', role: 'buero', title: 'Büroleitung und Disposition', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2019-03-01', field: false, team: null, skills: [], certifications: [] },
      { first: 'Katrin', last: 'Berger', role: 'buero', title: 'Kaufmännische Sachbearbeitung', employment: 'teilzeit', weeklyHours: 25, vacationDays: 19, entryDate: '2022-05-01', field: false, team: null, skills: [], certifications: [] },
      { first: 'Sven', last: 'Neumann', role: 'employee', title: 'Obermonteur Heizung', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2012-08-01', field: true, team: 'heizung', skills: ['Gasinstallation', 'Wärmepumpen', 'Hydraulischer Abgleich', 'Solarthermie'], certifications: ['Gas-Sachkunde (TRGI)', 'Schweißerprüfung', 'Führerschein Klasse B'] },
      { first: 'Markus', last: 'Weber', role: 'employee', title: 'Anlagenmechaniker SHK', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2017-09-01', field: true, team: 'heizung', skills: ['Gasinstallation', 'Fußbodenheizung'], certifications: ['Gas-Sachkunde (TRGI)', 'Führerschein Klasse B', 'Erste-Hilfe-Kurs'] },
      { first: 'Tobias', last: 'Schulz', role: 'employee', title: 'Kundendienstmonteur', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2018-04-16', field: true, team: 'service', skills: ['Gasinstallation', 'Wärmepumpen', 'Lüftungstechnik'], certifications: ['Gas-Sachkunde (TRGI)', 'Kälteschein Kategorie II', 'Führerschein Klasse B'] },
      { first: 'Andreas', last: 'Vogel', role: 'employee', title: 'Kundendienstmonteur Wärmepumpen', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2016-03-01', field: true, team: 'service', skills: ['Wärmepumpen', 'Lüftungstechnik', 'Solarthermie'], certifications: ['Kälteschein Kategorie II', 'Führerschein Klasse B', 'Erste-Hilfe-Kurs'] },
      { first: 'Daniel', last: 'Krüger', role: 'employee', title: 'Anlagenmechaniker SHK', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2020-01-06', field: true, team: 'sanitaer', skills: ['Badsanierung', 'Fußbodenheizung'], certifications: ['Führerschein Klasse B', 'Schweißerprüfung'] },
      { first: 'Fatih', last: 'Yıldız', role: 'employee', title: 'Anlagenmechaniker SHK', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2021-02-01', field: true, team: 'sanitaer', skills: ['Badsanierung', 'Gasinstallation'], certifications: ['Führerschein Klasse B', 'Erste-Hilfe-Kurs'] },
      { first: 'Paul', last: 'Lehmann', role: 'employee', title: 'Auszubildender, 3. Lehrjahr', employment: 'ausbildung', weeklyHours: 40, vacationDays: 27, entryDate: '2024-09-01', field: true, team: 'sanitaer', skills: ['Badsanierung'], certifications: ['Führerschein Klasse B'] },
      { first: 'Mia', last: 'Sommer', role: 'employee', title: 'Auszubildende, 1. Lehrjahr', employment: 'ausbildung', weeklyHours: 40, vacationDays: 27, entryDate: '2026-08-01', field: true, team: 'heizung', skills: [], certifications: [] },
      { first: 'Oliver', last: 'Brandt', role: 'employee', title: 'Helfer Lager und Baustelle', employment: 'minijob', weeklyHours: 10, vacationDays: 6, entryDate: '2025-11-03', field: true, team: null, skills: [], certifications: ['Führerschein Klasse B'] },
    ],
  },
  {
    key: 'rohde',
    seed: 20260802,
    name: 'Rohde & Sohn Sanitär Heizung',
    city: 'Potsdam',
    postalCodes: ['14467', '14469', '14471', '14473', '14476', '14478', '14480', '14482'],
    streets: POTSDAM_STREETS,
    region: 'BB',
    emailDomain: 'rohde-shk.example.com',
    plate: 'P-RS',
    phonePrefix: '0331 27',
    people: [
      { first: 'Sabine', last: 'Rohde', role: 'buero', title: 'Geschäftsführung, Büro', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2010-01-04', field: false, team: null, skills: [], certifications: [] },
      { first: 'Michael', last: 'Rohde', role: 'buero', title: 'Installateur- und Heizungsbauermeister', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2008-05-01', field: false, team: 'heizung', skills: ['Gasinstallation', 'Wärmepumpen', 'Hydraulischer Abgleich'], certifications: ['Gas-Sachkunde (TRGI)', 'Kälteschein Kategorie II'] },
      { first: 'Julia', last: 'Hoffmann', role: 'buero', title: 'Büro und Disposition', employment: 'teilzeit', weeklyHours: 30, vacationDays: 23, entryDate: '2020-03-02', field: false, team: null, skills: [], certifications: [] },
      { first: 'Erik', last: 'Lindner', role: 'employee', title: 'Obermonteur', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2011-06-01', field: true, team: 'heizung', skills: ['Gasinstallation', 'Wärmepumpen', 'Solarthermie', 'Hydraulischer Abgleich'], certifications: ['Gas-Sachkunde (TRGI)', 'Schweißerprüfung', 'Führerschein Klasse B'] },
      { first: 'Christian', last: 'Wolf', role: 'employee', title: 'Kundendienstmonteur', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2014-02-03', field: true, team: 'service', skills: ['Gasinstallation', 'Wärmepumpen', 'Lüftungstechnik'], certifications: ['Gas-Sachkunde (TRGI)', 'Kälteschein Kategorie II', 'Führerschein Klasse B', 'Erste-Hilfe-Kurs'] },
      { first: 'Kevin', last: 'Franke', role: 'employee', title: 'Anlagenmechaniker SHK', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2019-08-01', field: true, team: 'sanitaer', skills: ['Badsanierung', 'Fußbodenheizung'], certifications: ['Führerschein Klasse B'] },
      { first: 'Nadine', last: 'Krause', role: 'employee', title: 'Anlagenmechanikerin SHK', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2021-09-01', field: true, team: 'sanitaer', skills: ['Badsanierung', 'Gasinstallation'], certifications: ['Gas-Sachkunde (TRGI)', 'Führerschein Klasse B', 'Erste-Hilfe-Kurs'] },
      { first: 'Mehmet', last: 'Aydın', role: 'employee', title: 'Anlagenmechaniker SHK', employment: 'vollzeit', weeklyHours: 40, vacationDays: 30, entryDate: '2023-04-03', field: true, team: 'heizung', skills: ['Gasinstallation', 'Fußbodenheizung', 'Wärmepumpen'], certifications: ['Führerschein Klasse B', 'Schweißerprüfung'] },
      { first: 'Lukas', last: 'Peters', role: 'employee', title: 'Auszubildender, 2. Lehrjahr', employment: 'ausbildung', weeklyHours: 40, vacationDays: 27, entryDate: '2025-08-01', field: true, team: 'sanitaer', skills: [], certifications: ['Führerschein Klasse B'] },
      { first: 'Robert', last: 'Jahn', role: 'employee', title: 'Helfer', employment: 'minijob', weeklyHours: 10, vacationDays: 6, entryDate: '2024-10-01', field: true, team: null, skills: [], certifications: [] },
    ],
  },
];

const SKILLS: Record<string, string> = {
  Gasinstallation: 'Gasleitungen, Gasgeräte, Dichtheitsprüfung',
  Wärmepumpen: 'Luft-Wasser- und Sole-Wasser-Wärmepumpen, Inbetriebnahme und Service',
  Solarthermie: 'Kollektoranlagen, Solarstationen, Frostschutz',
  Badsanierung: 'Komplettbäder inklusive Fliesenkoordination',
  Lüftungstechnik: 'Zentrale und dezentrale Lüftung mit Wärmerückgewinnung',
  Fußbodenheizung: 'Verlegung, Verteiler, Abgleich',
  'Hydraulischer Abgleich': 'Verfahren B nach VdZ, Heizkurven',
};

const CERTIFICATIONS: Record<string, { description: string; warningDays: number; issuer: string; validYears: number }> = {
  'Gas-Sachkunde (TRGI)': { description: 'Sachkundenachweis nach DVGW-TRGI, alle 5 Jahre', warningDays: 90, issuer: 'Innung SHK Berlin', validYears: 5 },
  'Kälteschein Kategorie II': { description: 'Sachkunde nach ChemKlimaschutzV für Wärmepumpen', warningDays: 90, issuer: 'Handwerkskammer Berlin', validYears: 5 },
  Schweißerprüfung: { description: 'Schweißerprüfung nach DIN EN ISO 9606-1, alle 3 Jahre', warningDays: 60, issuer: 'SLV Berlin-Brandenburg', validYears: 3 },
  'Führerschein Klasse B': { description: 'Fahrerlaubnis für Firmenfahrzeuge', warningDays: 30, issuer: 'Landesamt für Bürger- und Ordnungsangelegenheiten', validYears: 15 },
  'Erste-Hilfe-Kurs': { description: 'Betrieblicher Ersthelfer, alle 2 Jahre auffrischen', warningDays: 60, issuer: 'DRK Kreisverband', validYears: 2 },
};

const TEAMS: Record<TeamKey, { name: string; description: string }> = {
  heizung: { name: 'Team Heizung', description: 'Heizungsbau, Wärmepumpen, Kesseltausch' },
  sanitaer: { name: 'Team Sanitär', description: 'Bäder, Trinkwasser, Abwasser' },
  service: { name: 'Kundendienst', description: 'Wartung, Störungen, Notdienst' },
};

type JobKind = {
  title: string;
  description: string;
  minutes: number;
  crew: 1 | 2;
  team: TeamKey;
  materials: Array<[string, number]>;
};

const SERVICE_JOBS: JobKind[] = [
  { title: 'Wartung Gas-Brennwerttherme', description: 'Jährliche Wartung nach Herstellervorgabe: Brenner reinigen, Abgaswerte messen, Wartungsprotokoll.', minutes: 90, crew: 1, team: 'service', materials: [['Wartungsset Brennwert', 1], ['Dichtung Brennerflansch', 1]] },
  { title: 'Wartung Wärmepumpe', description: 'Wartung Außeneinheit, Filter, Kältekreis-Sichtprüfung, Einstellungen dokumentieren.', minutes: 120, crew: 1, team: 'service', materials: [['Filtereinsatz Wärmepumpe', 1]] },
  { title: 'Störung Heizung: kein Warmwasser', description: 'Kunde meldet ausbleibende Warmwasserbereitung. Fehlerspeicher auslesen, Dreiwegeventil prüfen.', minutes: 90, crew: 1, team: 'service', materials: [['Dreiwegeventil Motor', 1]] },
  { title: 'Rohrbruch Küche, Notdienst', description: 'Wasseraustritt unter der Spüle, Leitung provisorisch abgesperrt. Schaden beheben.', minutes: 120, crew: 1, team: 'sanitaer', materials: [['Pressfitting Kupfer 15 mm', 4], ['Kupferrohr 15 mm', 2]] },
  { title: 'WC-Spülkasten undicht', description: 'Dauerläufer im Unterputz-Spülkasten. Füllventil und Heberglocke tauschen.', minutes: 60, crew: 1, team: 'sanitaer', materials: [['Füllventil Spülkasten', 1], ['Heberglocke', 1]] },
  { title: 'Waschtisch und Armatur austauschen', description: 'Alten Waschtisch demontieren, neuen Waschtisch mit Einhebelmischer montieren.', minutes: 150, crew: 1, team: 'sanitaer', materials: [['Einhebelmischer Waschtisch', 1], ['Eckventil 1/2 Zoll', 2], ['Flexschlauch 3/8 Zoll', 2]] },
  { title: 'Thermostatventile tauschen', description: 'Fünf Thermostatventile mit Voreinstellung tauschen, Anlage entlüften.', minutes: 120, crew: 1, team: 'heizung', materials: [['Thermostatventil Voreinstellung', 5], ['Thermostatkopf', 5]] },
  { title: 'Zirkulationspumpe erneuern', description: 'Defekte Zirkulationspumpe tauschen, Zeitschaltung neu einstellen.', minutes: 120, crew: 1, team: 'heizung', materials: [['Zirkulationspumpe', 1]] },
  { title: 'Abflussverstopfung Bad beseitigen', description: 'Abfluss Dusche verstopft. Spirale, Siphon reinigen, Dichtigkeit prüfen.', minutes: 60, crew: 1, team: 'sanitaer', materials: [] },
  { title: 'Trinkwasserfilter rückspülen und Wartung', description: 'Hauswasserstation rückspülen, Druckminderer prüfen, Filterelement tauschen.', minutes: 45, crew: 1, team: 'service', materials: [['Filterelement Hauswasserstation', 1]] },
  { title: 'Gasleitung Dichtheitsprüfung', description: 'Gebrauchsfähigkeitsprüfung der Gasinstallation nach TRGI mit Protokoll.', minutes: 90, crew: 1, team: 'heizung', materials: [] },
  { title: 'Heizkörper austauschen', description: 'Zwei Heizkörper gegen Flachheizkörper Typ 22 tauschen, Ventile erneuern.', minutes: 180, crew: 2, team: 'heizung', materials: [['Flachheizkörper Typ 22 600x1000', 2], ['Thermostatventil Voreinstellung', 2], ['Rücklaufverschraubung', 2]] },
  { title: 'Durchlauferhitzer ersetzen', description: 'Elektronischen Durchlauferhitzer 21 kW tauschen, Anschluss prüfen.', minutes: 150, crew: 1, team: 'sanitaer', materials: [['Durchlauferhitzer 21 kW', 1]] },
  { title: 'Legionellenprüfung Probenahme', description: 'Probenahme an den Entnahmestellen laut Plan, Versand an das Labor.', minutes: 60, crew: 1, team: 'service', materials: [] },
  { title: 'Solaranlage Frostschutz prüfen', description: 'Solarflüssigkeit prüfen, Druck einstellen, Ausdehnungsgefäß kontrollieren.', minutes: 90, crew: 1, team: 'heizung', materials: [['Solarflüssigkeit 10 l', 1]] },
  { title: 'Lüftungsanlage Filterwechsel', description: 'Filter der zentralen Lüftung wechseln, Volumenstrom kontrollieren.', minutes: 60, crew: 1, team: 'service', materials: [['Filterset Lüftung G4/F7', 1]] },
  { title: 'Hebeanlage Wartung', description: 'Hebeanlage reinigen, Rückschlagklappe prüfen, Probelauf.', minutes: 90, crew: 1, team: 'sanitaer', materials: [] },
  { title: 'Hydraulischer Abgleich', description: 'Heizlast je Raum berechnen, Ventile voreinstellen, Heizkurve anpassen.', minutes: 240, crew: 1, team: 'heizung', materials: [] },
  { title: 'Wasserzähler tauschen', description: 'Eichfälliger Wohnungswasserzähler tauschen, Zählerstand dokumentieren.', minutes: 45, crew: 1, team: 'sanitaer', materials: [['Wohnungswasserzähler', 1]] },
  { title: 'Gastherme Inbetriebnahme nach Tausch', description: 'Neue Brennwerttherme in Betrieb nehmen, Einweisung, Übergabeprotokoll.', minutes: 180, crew: 2, team: 'heizung', materials: [['Gas-Brennwerttherme 19 kW', 1], ['Abgasrohr DN 80 Set', 1]] },
];

type ProjectKind = { name: string; description: string; weeks: number; jobs: JobKind[] };

const PROJECT_KINDS: ProjectKind[] = [
  {
    name: 'Badsanierung komplett', description: 'Komplettsanierung Bad mit bodengleicher Dusche, neue Leitungen, Fußbodenheizung.', weeks: 4,
    jobs: [
      { title: 'Demontage Altbad', description: 'Sanitärobjekte demontieren, Leitungen absperren, Entsorgung.', minutes: 480, crew: 2, team: 'sanitaer', materials: [] },
      { title: 'Rohinstallation Sanitär', description: 'Neue Kalt- und Warmwasserleitungen, Abwasser, Vorwandinstallation.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Vorwandelement WC', 1], ['Kupferrohr 15 mm', 12], ['Pressfitting Kupfer 15 mm', 20], ['HT-Rohr DN 50', 4]] },
      { title: 'Fußbodenheizung verlegen', description: 'Verteiler setzen, Rohr verlegen, Druckprobe.', minutes: 480, crew: 2, team: 'heizung', materials: [['Fußbodenheizung Verteiler 5-fach', 1], ['Fußbodenheizungsrohr 16x2 (Rolle 200 m)', 1]] },
      { title: 'Montage Sanitärobjekte', description: 'Nach Fliesenlegerarbeiten: WC, Waschtisch, Dusche montieren.', minutes: 480, crew: 1, team: 'sanitaer', materials: [['Einhebelmischer Waschtisch', 1], ['Duscharmatur Aufputz', 1], ['Wand-WC spülrandlos', 1]] },
      { title: 'Endmontage und Abnahme', description: 'Silikonfugen, Funktionsprüfung, Übergabe an den Kunden.', minutes: 240, crew: 1, team: 'sanitaer', materials: [['Sanitärsilikon', 2]] },
    ],
  },
  {
    name: 'Heizungsmodernisierung Wärmepumpe', description: 'Tausch der Ölheizung gegen eine Luft-Wasser-Wärmepumpe mit Pufferspeicher.', weeks: 3,
    jobs: [
      { title: 'Demontage Ölkessel', description: 'Kessel und Tank stilllegen, Entsorgung koordinieren.', minutes: 480, crew: 2, team: 'heizung', materials: [] },
      { title: 'Aufstellung Außeneinheit', description: 'Fundament prüfen, Außeneinheit setzen, Kältemittelleitung verlegen.', minutes: 480, crew: 2, team: 'heizung', materials: [['Wärmepumpe Außeneinheit 8 kW', 1], ['Wärmepumpen-Konsole', 1]] },
      { title: 'Hydraulik und Pufferspeicher', description: 'Pufferspeicher, Hydraulikmodul, Anbindung an das Heizsystem.', minutes: 960, crew: 2, team: 'heizung', materials: [['Pufferspeicher 300 l', 1], ['Kupferrohr 28 mm', 10], ['Pressfitting Kupfer 28 mm', 12]] },
      { title: 'Inbetriebnahme und Einweisung', description: 'Inbetriebnahme mit Herstellerprotokoll, Heizkurve, Kundeneinweisung.', minutes: 300, crew: 1, team: 'service', materials: [] },
    ],
  },
  {
    name: 'Neubau Einfamilienhaus, Sanitär und Heizung', description: 'Komplette Haustechnik im Neubau: Verteilung, Rohinstallation, Fertigmontage.', weeks: 8,
    jobs: [
      { title: 'Kellerverteilung und Hausanschluss', description: 'Hauswasserstation, Verteiler, Anbindung Hausanschluss.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Hauswasserstation', 1], ['Kupferrohr 28 mm', 15]] },
      { title: 'Rohinstallation Erdgeschoss', description: 'Leitungen Küche, Gäste-WC, Hauswirtschaftsraum.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Kupferrohr 15 mm', 30], ['Pressfitting Kupfer 15 mm', 40], ['HT-Rohr DN 50', 8]] },
      { title: 'Rohinstallation Obergeschoss', description: 'Leitungen für zwei Bäder, Vorwandelemente.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Vorwandelement WC', 2], ['Kupferrohr 15 mm', 30], ['Pressfitting Kupfer 15 mm', 40]] },
      { title: 'Fußbodenheizung beide Etagen', description: 'Verteiler und Heizkreise, Druckprobe.', minutes: 960, crew: 2, team: 'heizung', materials: [['Fußbodenheizung Verteiler 5-fach', 2], ['Fußbodenheizungsrohr 16x2 (Rolle 200 m)', 3]] },
      { title: 'Fertigmontage Sanitär', description: 'Objekte montieren, Armaturen, Funktionsprüfung.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Einhebelmischer Waschtisch', 3], ['Wand-WC spülrandlos', 2], ['Duscharmatur Aufputz', 2]] },
    ],
  },
  {
    name: 'Dachgeschossausbau, Bad und Heizung', description: 'Neues Bad und Heizkörper im ausgebauten Dachgeschoss.', weeks: 3,
    jobs: [
      { title: 'Rohinstallation Dachgeschoss', description: 'Leitungen Bad und Heizung, Vorwandinstallation.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Vorwandelement WC', 1], ['Kupferrohr 15 mm', 20], ['Pressfitting Kupfer 15 mm', 24]] },
      { title: 'Heizkörper montieren', description: 'Drei Flachheizkörper anschließen, entlüften, abgleichen.', minutes: 300, crew: 1, team: 'heizung', materials: [['Flachheizkörper Typ 22 600x1000', 3], ['Thermostatventil Voreinstellung', 3]] },
      { title: 'Fertigmontage Bad', description: 'Objekte und Armaturen montieren, Abnahme.', minutes: 480, crew: 1, team: 'sanitaer', materials: [['Einhebelmischer Waschtisch', 1], ['Wand-WC spülrandlos', 1]] },
    ],
  },
  {
    name: 'Strangsanierung Mehrfamilienhaus', description: 'Erneuerung der Steigstränge Kalt-, Warmwasser und Zirkulation in drei Strängen.', weeks: 6,
    jobs: [
      { title: 'Strang A erneuern', description: 'Steigstrang A, Absperrungen je Wohnung, Wasserzähler.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Kupferrohr 28 mm', 30], ['Pressfitting Kupfer 28 mm', 30], ['Wohnungswasserzähler', 6]] },
      { title: 'Strang B erneuern', description: 'Steigstrang B, Absperrungen je Wohnung, Wasserzähler.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Kupferrohr 28 mm', 30], ['Pressfitting Kupfer 28 mm', 30], ['Wohnungswasserzähler', 6]] },
      { title: 'Strang C erneuern', description: 'Steigstrang C, Absperrungen je Wohnung, Wasserzähler.', minutes: 960, crew: 2, team: 'sanitaer', materials: [['Kupferrohr 28 mm', 30], ['Pressfitting Kupfer 28 mm', 30], ['Wohnungswasserzähler', 6]] },
      { title: 'Druckprobe und Abnahme', description: 'Druckprobe aller Stränge, Spülung, Protokoll für die Hausverwaltung.', minutes: 480, crew: 1, team: 'service', materials: [] },
    ],
  },
];

type ItemSpec = { name: string; unit: string; type: 'material' | 'consumable' | 'tool'; purchase: number; sale: number; minimum: number; initial: number; category: string };

const ITEMS: ItemSpec[] = [
  { name: 'Kupferrohr 15 mm', unit: 'm', type: 'material', purchase: 640, sale: 1190, minimum: 50, initial: 180, category: 'rohr' },
  { name: 'Kupferrohr 28 mm', unit: 'm', type: 'material', purchase: 1290, sale: 2290, minimum: 30, initial: 120, category: 'rohr' },
  { name: 'Pressfitting Kupfer 15 mm', unit: 'Stk', type: 'material', purchase: 210, sale: 490, minimum: 100, initial: 400, category: 'fitting' },
  { name: 'Pressfitting Kupfer 28 mm', unit: 'Stk', type: 'material', purchase: 480, sale: 990, minimum: 60, initial: 200, category: 'fitting' },
  { name: 'HT-Rohr DN 50', unit: 'm', type: 'material', purchase: 320, sale: 690, minimum: 20, initial: 60, category: 'rohr' },
  { name: 'Eckventil 1/2 Zoll', unit: 'Stk', type: 'material', purchase: 590, sale: 1290, minimum: 20, initial: 60, category: 'armatur' },
  { name: 'Flexschlauch 3/8 Zoll', unit: 'Stk', type: 'material', purchase: 390, sale: 890, minimum: 20, initial: 50, category: 'armatur' },
  { name: 'Einhebelmischer Waschtisch', unit: 'Stk', type: 'material', purchase: 6900, sale: 12900, minimum: 4, initial: 12, category: 'armatur' },
  { name: 'Duscharmatur Aufputz', unit: 'Stk', type: 'material', purchase: 9900, sale: 17900, minimum: 2, initial: 6, category: 'armatur' },
  { name: 'Wand-WC spülrandlos', unit: 'Stk', type: 'material', purchase: 18900, sale: 32900, minimum: 2, initial: 6, category: 'sanitaer' },
  { name: 'Vorwandelement WC', unit: 'Stk', type: 'material', purchase: 15900, sale: 26900, minimum: 2, initial: 6, category: 'sanitaer' },
  { name: 'Füllventil Spülkasten', unit: 'Stk', type: 'material', purchase: 1490, sale: 3290, minimum: 5, initial: 15, category: 'sanitaer' },
  { name: 'Heberglocke', unit: 'Stk', type: 'material', purchase: 1290, sale: 2890, minimum: 5, initial: 15, category: 'sanitaer' },
  { name: 'Thermostatventil Voreinstellung', unit: 'Stk', type: 'material', purchase: 2190, sale: 4490, minimum: 20, initial: 60, category: 'heizung' },
  { name: 'Thermostatkopf', unit: 'Stk', type: 'material', purchase: 1390, sale: 2990, minimum: 20, initial: 60, category: 'heizung' },
  { name: 'Rücklaufverschraubung', unit: 'Stk', type: 'material', purchase: 1190, sale: 2490, minimum: 10, initial: 30, category: 'heizung' },
  { name: 'Flachheizkörper Typ 22 600x1000', unit: 'Stk', type: 'material', purchase: 11900, sale: 21900, minimum: 2, initial: 8, category: 'heizung' },
  { name: 'Zirkulationspumpe', unit: 'Stk', type: 'material', purchase: 14900, sale: 26900, minimum: 2, initial: 5, category: 'heizung' },
  { name: 'Dreiwegeventil Motor', unit: 'Stk', type: 'material', purchase: 8900, sale: 16900, minimum: 2, initial: 5, category: 'heizung' },
  { name: 'Wartungsset Brennwert', unit: 'Stk', type: 'material', purchase: 4900, sale: 8900, minimum: 10, initial: 30, category: 'heizung' },
  { name: 'Dichtung Brennerflansch', unit: 'Stk', type: 'material', purchase: 890, sale: 1990, minimum: 10, initial: 30, category: 'heizung' },
  { name: 'Filtereinsatz Wärmepumpe', unit: 'Stk', type: 'material', purchase: 2900, sale: 5900, minimum: 5, initial: 15, category: 'heizung' },
  { name: 'Filterelement Hauswasserstation', unit: 'Stk', type: 'material', purchase: 1990, sale: 3990, minimum: 10, initial: 25, category: 'sanitaer' },
  { name: 'Filterset Lüftung G4/F7', unit: 'Stk', type: 'material', purchase: 3900, sale: 6900, minimum: 5, initial: 12, category: 'lueftung' },
  { name: 'Solarflüssigkeit 10 l', unit: 'Kanister', type: 'material', purchase: 5900, sale: 9900, minimum: 3, initial: 8, category: 'heizung' },
  { name: 'Durchlauferhitzer 21 kW', unit: 'Stk', type: 'material', purchase: 32900, sale: 52900, minimum: 1, initial: 3, category: 'sanitaer' },
  { name: 'Wohnungswasserzähler', unit: 'Stk', type: 'material', purchase: 2490, sale: 4990, minimum: 10, initial: 40, category: 'sanitaer' },
  { name: 'Gas-Brennwerttherme 19 kW', unit: 'Stk', type: 'material', purchase: 189000, sale: 269000, minimum: 0, initial: 2, category: 'heizung' },
  { name: 'Abgasrohr DN 80 Set', unit: 'Set', type: 'material', purchase: 21900, sale: 34900, minimum: 1, initial: 4, category: 'heizung' },
  { name: 'Wärmepumpe Außeneinheit 8 kW', unit: 'Stk', type: 'material', purchase: 690000, sale: 890000, minimum: 0, initial: 1, category: 'heizung' },
  { name: 'Wärmepumpen-Konsole', unit: 'Stk', type: 'material', purchase: 24900, sale: 39900, minimum: 0, initial: 2, category: 'heizung' },
  { name: 'Pufferspeicher 300 l', unit: 'Stk', type: 'material', purchase: 89000, sale: 129000, minimum: 0, initial: 2, category: 'heizung' },
  { name: 'Hauswasserstation', unit: 'Stk', type: 'material', purchase: 21900, sale: 36900, minimum: 1, initial: 4, category: 'sanitaer' },
  { name: 'Fußbodenheizung Verteiler 5-fach', unit: 'Stk', type: 'material', purchase: 15900, sale: 26900, minimum: 1, initial: 4, category: 'heizung' },
  { name: 'Fußbodenheizungsrohr 16x2 (Rolle 200 m)', unit: 'Rolle', type: 'material', purchase: 14900, sale: 24900, minimum: 2, initial: 6, category: 'rohr' },
  { name: 'Sanitärsilikon', unit: 'Kartusche', type: 'consumable', purchase: 490, sale: 990, minimum: 12, initial: 40, category: 'verbrauch' },
  { name: 'Hanf und Dichtpaste Set', unit: 'Set', type: 'consumable', purchase: 690, sale: 1290, minimum: 6, initial: 20, category: 'verbrauch' },
  { name: 'Lötzinn 250 g', unit: 'Rolle', type: 'consumable', purchase: 1890, sale: 2990, minimum: 4, initial: 10, category: 'verbrauch' },
  { name: 'Pressmaschine Akku', unit: 'Stk', type: 'tool', purchase: 129000, sale: 0, minimum: 0, initial: 3, category: 'werkzeug' },
  { name: 'Abgasmessgerät', unit: 'Stk', type: 'tool', purchase: 89000, sale: 0, minimum: 0, initial: 2, category: 'werkzeug' },
  { name: 'Rohrreinigungsspirale elektrisch', unit: 'Stk', type: 'tool', purchase: 64900, sale: 0, minimum: 0, initial: 1, category: 'werkzeug' },
];

const SUPPLIERS = [
  { name: 'GC Gruppe, Cordes & Graefe Berlin', customerNumber: '118 442', email: 'bestellung@gc-berlin.example.com', phone: '030 9900 1200' },
  { name: 'Richter+Frenzel', customerNumber: '70 5531', email: 'niederlassung-berlin@r-f.example.com', phone: '030 9900 4400' },
  { name: 'Pfeiffer & May', customerNumber: 'P&M 20941', email: 'service@pfeiffer-may.example.com', phone: '030 9900 7800' },
];

type EquipmentKind = { name: string; category: Database['public']['Enums']['installed_equipment_category']; subtype: Database['public']['Enums']['installed_equipment_subtype'] | null; manufacturer: string; model: string; year: [number, number] };

const EQUIPMENT_KINDS: EquipmentKind[] = [
  { name: 'Gas-Brennwerttherme', category: 'heat_generation', subtype: 'gas_boiler', manufacturer: 'Viessmann', model: 'Vitodens 200-W B2HF 19 kW', year: [2016, 2025] },
  { name: 'Gas-Brennwerttherme', category: 'heat_generation', subtype: 'gas_boiler', manufacturer: 'Vaillant', model: 'ecoTEC plus VC 206/5-5', year: [2014, 2024] },
  { name: 'Gas-Brennwertkessel', category: 'heat_generation', subtype: 'gas_boiler', manufacturer: 'Buderus', model: 'Logamax plus GB192i 25 kW', year: [2017, 2025] },
  { name: 'Gas-Brennwerttherme', category: 'heat_generation', subtype: 'gas_boiler', manufacturer: 'Wolf', model: 'CGB-2-20', year: [2015, 2023] },
  { name: 'Luft-Wasser-Wärmepumpe', category: 'heat_generation', subtype: 'heat_pump', manufacturer: 'Vaillant', model: 'aroTHERM plus VWL 75/6', year: [2021, 2026] },
  { name: 'Luft-Wasser-Wärmepumpe', category: 'heat_generation', subtype: 'heat_pump', manufacturer: 'Viessmann', model: 'Vitocal 250-A AWO-E-AC 251.A10', year: [2022, 2026] },
  { name: 'Luft-Wasser-Wärmepumpe', category: 'heat_generation', subtype: 'heat_pump', manufacturer: 'Stiebel Eltron', model: 'WPL 17 ACS classic', year: [2020, 2025] },
  { name: 'Öl-Brennwertkessel', category: 'heat_generation', subtype: 'oil_boiler', manufacturer: 'Buderus', model: 'Logano plus GB125 22 kW', year: [2008, 2016] },
  { name: 'Warmwasserspeicher', category: 'storage_and_hot_water', subtype: 'domestic_hot_water_storage', manufacturer: 'Viessmann', model: 'Vitocell 100-V 160 l', year: [2014, 2025] },
  { name: 'Pufferspeicher', category: 'storage_and_hot_water', subtype: 'buffer_storage', manufacturer: 'Vaillant', model: 'allSTOR VPS 300/3', year: [2020, 2026] },
  { name: 'Frischwasserstation', category: 'storage_and_hot_water', subtype: 'fresh_water_station', manufacturer: 'Oventrop', model: 'Regumaq X-30', year: [2018, 2025] },
  { name: 'Durchlauferhitzer', category: 'storage_and_hot_water', subtype: 'instantaneous_water_heater', manufacturer: 'Stiebel Eltron', model: 'DHE 21 Touch', year: [2016, 2026] },
  { name: 'Zentrale Lüftungsanlage', category: 'ventilation', subtype: 'central_ventilation_with_heat_recovery', manufacturer: 'Zehnder', model: 'ComfoAir Q350', year: [2018, 2025] },
  { name: 'Solarthermieanlage', category: 'solar_thermal', subtype: null, manufacturer: 'Viessmann', model: 'Vitosol 200-FM, 3 Kollektoren', year: [2012, 2022] },
  { name: 'Hauswasserstation', category: 'water_and_sanitary_system', subtype: 'water_treatment', manufacturer: 'BWT', model: 'E1 HWS', year: [2015, 2026] },
  { name: 'Hebeanlage', category: 'water_and_sanitary_system', subtype: 'wastewater_lifting', manufacturer: 'KESSEL', model: 'Aqualift F Compact', year: [2013, 2024] },
];

const PRIVATE_LAST_NAMES = ['Müller', 'Schneider', 'Fischer', 'Meyer', 'Wagner', 'Becker', 'Schäfer', 'Koch', 'Richter', 'Klein', 'Schröder', 'Braun', 'Zimmermann', 'Hartwig', 'Lange', 'Schmitt', 'Werner', 'Krause', 'Lorenz', 'Böhm', 'Kaiser', 'Fuchs', 'Jung', 'Hahn', 'Keller', 'Otto', 'Winkler'];
const PRIVATE_FIRST_NAMES = ['Anna', 'Peter', 'Sabine', 'Thomas', 'Claudia', 'Frank', 'Monika', 'Stefan', 'Ute', 'Jürgen', 'Birgit', 'Matthias', 'Heike', 'Wolfgang', 'Petra', 'Uwe', 'Renate', 'Dieter', 'Elke', 'Ralf', 'Ingrid', 'Bernd', 'Silke', 'Holger', 'Gabriele', 'Norbert', 'Karin'];
const COMMERCIAL_CLIENTS = [
  { name: 'Hausverwaltung Müller & Partner GmbH', sites: 3, contact: 'Objektbetreuung' },
  { name: 'WEG Lindenstraße 12', sites: 1, contact: 'Verwaltungsbeirat' },
  { name: 'Wohnungsbaugenossenschaft Nord eG', sites: 3, contact: 'Technischer Bestand' },
  { name: 'Bäckerei Kroll', sites: 1, contact: 'Inhaber' },
  { name: 'Kita Sonnenblume', sites: 1, contact: 'Leitung' },
  { name: 'Physiotherapie Am Park', sites: 1, contact: 'Praxisleitung' },
  { name: 'Hotel Havelblick', sites: 1, contact: 'Haustechnik' },
  { name: 'Autohaus Becker GmbH', sites: 1, contact: 'Werkstattleitung' },
  { name: 'Zahnarztpraxis Dr. Schmidt', sites: 1, contact: 'Praxismanagement' },
  { name: 'Restaurant Zur Alten Mühle', sites: 1, contact: 'Inhaberin' },
  { name: 'Fitnessstudio Bodyline', sites: 1, contact: 'Studioleitung' },
  { name: 'Evangelische Kirchengemeinde', sites: 2, contact: 'Küsterei' },
  { name: 'Schreinerei Hoppe', sites: 1, contact: 'Inhaber' },
  { name: 'Steuerkanzlei Voss & Kollegen', sites: 1, contact: 'Büroleitung' },
];

type RequestSpec = { summary: string; details: string; category: Database['public']['Enums']['request_category']; urgency: Database['public']['Enums']['request_urgency']; source: Database['public']['Enums']['request_source']; outcome: 'offen' | 'in_klaerung' | 'job' | 'service_case' | 'geschlossen'; receivedAt: string };

const REQUESTS: RequestSpec[] = [
  { summary: 'Heizung springt nicht an, Fehlercode F.28', details: 'Therme zeigt seit heute Morgen F.28. Kein Warmwasser, kleines Kind im Haushalt.', category: 'stoerung_reparatur', urgency: 'hoch', source: 'telefon', outcome: 'service_case', receivedAt: '2026-09-14T07:40' },
  { summary: 'Tropfender Wasserhahn in der Küche', details: 'Einhebelmischer tropft seit Wochen, Kunde wünscht Austausch gegen ein einfaches Modell.', category: 'stoerung_reparatur', urgency: 'niedrig', source: 'email', outcome: 'job', receivedAt: '2026-08-05T09:15' },
  { summary: 'Angebot Badsanierung Dachgeschoss', details: 'Bad 6 m², bodengleiche Dusche gewünscht, Fliesen stellt der Kunde. Vor-Ort-Termin erbeten.', category: 'angebotsanfrage', urgency: 'normal', source: 'email', outcome: 'in_klaerung', receivedAt: '2026-09-09T11:30' },
  { summary: 'Wartung Gastherme vor der Heizperiode', details: 'Jährliche Wartung, letztes Mal im Oktober 2025. Terminwunsch vormittags.', category: 'wartung', urgency: 'normal', source: 'telefon', outcome: 'job', receivedAt: '2026-08-12T10:05' },
  { summary: 'Wasserschaden Keller, Leitung geplatzt', details: 'Hauptabsperrung ist zu. Versicherung ist informiert, bittet um Schadensaufnahme.', category: 'notfall', urgency: 'notfall', source: 'telefon', outcome: 'job', receivedAt: '2026-08-19T06:50' },
  { summary: 'Wärmepumpe brummt laut nachts', details: 'Außeneinheit seit dem Wochenende deutlich lauter, Nachbarn beschweren sich.', category: 'stoerung_reparatur', urgency: 'hoch', source: 'telefon', outcome: 'service_case', receivedAt: '2026-09-16T08:20' },
  { summary: 'Heizkörper im Kinderzimmer bleibt kalt', details: 'Andere Heizkörper werden warm, dieser nicht. Entlüften hat nichts gebracht.', category: 'stoerung_reparatur', urgency: 'normal', source: 'email', outcome: 'job', receivedAt: '2026-09-01T14:10' },
  { summary: 'Angebot Wärmepumpe statt Ölheizung', details: 'Einfamilienhaus Baujahr 1994, 160 m², Ölkessel von 2003. Förderung soll mit beantragt werden.', category: 'angebotsanfrage', urgency: 'normal', source: 'vor_ort', outcome: 'in_klaerung', receivedAt: '2026-09-11T16:00' },
  { summary: 'Garantiefall: Pumpe der neuen Therme klackert', details: 'Therme im Mai eingebaut, seit zwei Tagen Klackern beim Anlauf.', category: 'garantie_mangel', urgency: 'normal', source: 'telefon', outcome: 'job', receivedAt: '2026-08-26T09:45' },
  { summary: 'Frage zur Legionellenprüfung', details: 'Vermieter fragt, ob die Prüfung dieses Jahr fällig ist und was sie kostet.', category: 'allgemeine_frage', urgency: 'niedrig', source: 'email', outcome: 'geschlossen', receivedAt: '2026-08-07T13:20' },
  { summary: 'Zweitmeinung zu Angebot eines anderen Betriebs', details: 'Kunde hat ein Angebot für einen Kesseltausch und bittet um Vergleich.', category: 'sonstiges', urgency: 'niedrig', source: 'telefon', outcome: 'geschlossen', receivedAt: '2026-08-21T11:00' },
  { summary: 'Neue Waschmaschine anschließen', details: 'Anschluss im Keller vorhanden, aber ohne Aquastop. Kunde möchte einen Termin nächste Woche.', category: 'installation_umbau', urgency: 'niedrig', source: 'telefon', outcome: 'offen', receivedAt: '2026-09-15T10:30' },
  { summary: 'Warmwasser wird nur lauwarm', details: 'Seit einigen Tagen wird das Wasser nicht mehr richtig heiß, Speicher ist von 2011.', category: 'stoerung_reparatur', urgency: 'normal', source: 'email', outcome: 'offen', receivedAt: '2026-09-17T08:05' },
  { summary: 'Angebot Lüftungsanlage Neubau', details: 'Bauherr plant KfW-40-Haus, wünscht Angebot für zentrale Lüftung mit Wärmerückgewinnung.', category: 'angebotsanfrage', urgency: 'normal', source: 'email', outcome: 'offen', receivedAt: '2026-09-17T15:40' },
  { summary: 'Gasgeruch im Hausflur', details: 'Mieterin meldet leichten Gasgeruch. Wurde an den Netzbetreiber verwiesen, Nachkontrolle erbeten.', category: 'notfall', urgency: 'notfall', source: 'telefon', outcome: 'job', receivedAt: '2026-09-03T18:15' },
  { summary: 'Rückruf wegen Wartungsvertrag', details: 'Hausverwaltung möchte alle Objekte in einen Wartungsvertrag aufnehmen.', category: 'wartung', urgency: 'normal', source: 'telefon', outcome: 'offen', receivedAt: '2026-09-18T09:10' },
];

type TemplateSpec = { name: string; description: string; items: Array<[string, 'task' | 'checklist', string | null]> };

const TEMPLATES: TemplateSpec[] = [
  {
    name: 'Wartung Gas-Brennwerttherme', description: 'Jährliche Wartung nach Herstellervorgabe mit Abgasmessung.',
    items: [['Anlage stromlos schalten und Gas absperren', 'checklist', 'Sicherheit'], ['Brennkammer und Brenner reinigen', 'task', 'Wartung'], ['Elektroden und Dichtungen prüfen, bei Bedarf tauschen', 'task', 'Wartung'], ['Siphon reinigen und befüllen', 'task', 'Wartung'], ['Ausdehnungsgefäß Vordruck prüfen', 'task', 'Wartung'], ['Abgasmessung durchführen und protokollieren', 'checklist', 'Messung'], ['Gasdichtheit prüfen', 'checklist', 'Messung'], ['Wartungsprotokoll vom Kunden unterschreiben lassen', 'checklist', 'Abschluss']],
  },
  {
    name: 'Wartung Wärmepumpe', description: 'Wartung Luft-Wasser-Wärmepumpe innen und außen.',
    items: [['Außeneinheit auf Verschmutzung und Beschädigung prüfen', 'checklist', 'Außeneinheit'], ['Verdampfer reinigen', 'task', 'Außeneinheit'], ['Kondensatablauf prüfen', 'checklist', 'Außeneinheit'], ['Filter und Schmutzfänger reinigen', 'task', 'Inneneinheit'], ['Anlagendruck und Ausdehnungsgefäß prüfen', 'task', 'Inneneinheit'], ['Einstellungen und Fehlerspeicher dokumentieren', 'checklist', 'Abschluss']],
  },
  {
    name: 'Badsanierung Standard', description: 'Ablauf einer Komplettbadsanierung vom Rückbau bis zur Übergabe.',
    items: [['Bestand fotografieren und Maße aufnehmen', 'checklist', 'Vorbereitung'], ['Wasser und Strom im Bad absperren', 'checklist', 'Vorbereitung'], ['Altobjekte demontieren und entsorgen', 'task', 'Rückbau'], ['Leitungen neu verlegen und Druckprobe', 'task', 'Rohinstallation'], ['Vorwandelemente setzen und ausrichten', 'task', 'Rohinstallation'], ['Objekte und Armaturen montieren', 'task', 'Fertigmontage'], ['Silikonfugen und Funktionsprüfung', 'task', 'Fertigmontage'], ['Übergabe mit Kunden und Abnahmeprotokoll', 'checklist', 'Abschluss']],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRandom(seed: number): { next: () => number; int: (min: number, max: number) => number; pick: <T>(items: readonly T[]) => T; chance: (probability: number) => boolean } {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick from empty list');
      return item;
    },
    chance: (probability) => next() < probability,
  };
}

type Random = ReturnType<typeof createRandom>;

function shiftDate(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekday(dateIso: string): number {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

function berlinInstant(dateIso: string, time: string): string {
  const resolved = resolveBerlinWallTime(`${dateIso}T${time}`);
  if (!resolved) throw new Error(`Cannot resolve ${dateIso}T${time} in Europe/Berlin.`);
  return resolved.instant.toISOString();
}

function minutesToClock(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function listWorkdays(from: string, to: string, holidays: Set<string>): string[] {
  const days: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const day = weekday(date);
    if (day === 0 || day === 6 || holidays.has(date)) continue;
    days.push(date);
  }
  return days;
}

function randomOrganizationCode(random: Random): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) code += ORGANIZATION_CODE_CHARSET.charAt(random.int(0, ORGANIZATION_CODE_CHARSET.length - 1));
  return code;
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z]/g, '');
}

function fail(step: string, error: { message: string } | null): never {
  throw new Error(`${step}: ${error?.message ?? 'unknown error'}`);
}

// PostgREST fills keys that only some rows of a batch carry with explicit nulls,
// which overrides column defaults; rows are therefore grouped by key set.
async function insertRows<T extends keyof Tables>(admin: Admin, table: T, rows: Insert<T>[], batchSize = 400): Promise<void> {
  const groups = new Map<string, Insert<T>[]>();
  for (const row of rows) {
    const signature = Object.keys(row).sort().join(',');
    groups.set(signature, [...(groups.get(signature) ?? []), row]);
  }
  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index += batchSize) {
      const { error } = await admin.from(table).insert(group.slice(index, index + batchSize) as never);
      if (error) fail(`insert ${String(table)} batch ${index / batchSize + 1}`, error);
    }
  }
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

// ---------------------------------------------------------------------------
// Environment and guards
// ---------------------------------------------------------------------------

type Target = keyof typeof ENV_FILES;

function loadEnvironment(target: Target): { url: string; secretKey: string } {
  const file = resolve(process.cwd(), ENV_FILES[target]);
  const values = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, raw] = match;
    if (!key || raw === undefined) continue;
    values.set(key, raw.replace(/^["']|["']$/g, ''));
  }
  const url = values.get('NEXT_PUBLIC_SUPABASE_URL');
  const secretKey = values.get('SUPABASE_SECRET_KEY');
  if (!url || !secretKey) throw new Error(`${ENV_FILES[target]} lacks NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY`);
  // The R2 helper reads its configuration from process.env at call time.
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT', 'R2_JURISDICTION']) {
    const value = values.get(key);
    if (value) process.env[key] = value;
  }
  return { url, secretKey };
}

async function findOwner(admin: Admin): Promise<{ id: string; firstName: string; lastName: string }> {
  const { data, error } = await admin.from('profiles').select('id, first_name, last_name').eq('email', OWNER_EMAIL).single();
  if (error || !data) fail(`owner ${OWNER_EMAIL} lookup`, error);
  return { id: data.id, firstName: data.first_name ?? 'Tamay', lastName: data.last_name ?? 'Can' };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function resetOwnerOrganizations(admin: Admin, ownerId: string): Promise<void> {
  const { data: organizations, error } = await admin.from('organizations').select('id, name, admin_id').eq('admin_id', ownerId);
  if (error) fail('list owned organizations', error);
  const candidateUsers = new Set<string>();
  for (const organization of organizations ?? []) {
    if (organization.id === WILLERT_ORGANIZATION_ID || organization.admin_id !== ownerId) {
      throw new Error(`Refusing to touch organization ${organization.id} (${organization.name})`);
    }
    const { data: members, error: membersError } = await admin.from('organization_members').select('user_id').eq('organization_id', organization.id);
    if (membersError) fail('list members', membersError);
    for (const member of members ?? []) if (member.user_id !== ownerId) candidateUsers.add(member.user_id);

    const objectPaths = await listStorageObjectPaths(`${organization.id}/`);
    if (objectPaths.length > 0) await deleteStorageObjects(objectPaths);

    const { data: deleted, error: deleteError } = await admin.from('organizations').delete().eq('id', organization.id).eq('admin_id', ownerId).select('id');
    if (deleteError) fail(`delete organization ${organization.name}`, deleteError);
    log(`reset: deleted organization "${organization.name}" (${organization.id}), ${objectPaths.length} R2 objects, rows removed ${deleted?.length ?? 0}`);
  }

  // Demo users from an interrupted run may exist without a membership; sweep them by domain.
  const demoDomains = COMPANIES.map((company) => `@${company.emailDomain}`);
  const { data: userPage, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) {
    // GoTrue refuses to list when a legacy auth row is malformed; the sweep is best effort.
    log(`reset: user sweep skipped (${usersError.message})`);
  } else {
    for (const user of userPage.users) {
      if (user.id !== ownerId && demoDomains.some((domain) => user.email?.endsWith(domain))) candidateUsers.add(user.id);
    }
  }

  let deletedUsers = 0;
  for (const userId of candidateUsers) {
    const [{ count: memberships }, { count: owned }] = await Promise.all([
      admin.from('organization_members').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      admin.from('organizations').select('id', { count: 'exact', head: true }).eq('admin_id', userId),
    ]);
    if ((memberships ?? 0) > 0 || (owned ?? 0) > 0) continue;
    const { error: userError } = await admin.auth.admin.deleteUser(userId);
    if (userError) fail(`delete orphaned user ${userId}`, userError);
    deletedUsers += 1;
  }
  log(`reset: removed ${organizations?.length ?? 0} organizations and ${deletedUsers} orphaned member users`);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

type Member = PersonSpec & { userId: string; employeeRecordId: string };
type Customer = { id: string; name: string; type: 'privat' | 'gewerblich'; siteIds: string[]; contactId: string; address: string };
type SeededJob = { id: string; title: string; kind: JobKind; plannedDate: string | null; assignees: Member[]; phase: 'done' | 'active' | 'planned' | 'parked'; clientId: string; siteId: string; contactId: string };

async function createMembers(admin: Admin, company: CompanySpec, organizationId: string, random: Random): Promise<Member[]> {
  const members: Member[] = [];
  for (const [index, person] of company.people.entries()) {
    const email = `${slug(person.first)}.${slug(person.last)}@${company.emailDomain}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { first_name: person.first, last_name: person.last },
    });
    if (error || !data.user) fail(`create user ${email}`, error);
    const userId = data.user.id;
    await insertRows(admin, 'subscriptions', [{ user_id: userId, status: 'active', plan_id: 'demo' }]);
    await insertRows(admin, 'organization_members', [{ user_id: userId, organization_id: organizationId, role: person.role, joined_at: berlinInstant(person.entryDate, '08:00') }]);
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .update({
        first_name: person.first,
        last_name: person.last,
        employee_number: `MA-${String(index + 2).padStart(3, '0')}`,
        phone: `0176 ${random.int(200, 999)} ${random.int(10000, 99999)}`,
        street: `${random.pick(company.streets)} ${random.int(1, 120)}`,
        postal_code: random.pick(company.postalCodes),
        city: company.city,
        emergency_contact_name: `${random.pick(PRIVATE_FIRST_NAMES)} ${person.last}`,
        emergency_contact_phone: `0176 ${random.int(200, 999)} ${random.int(10000, 99999)}`,
        notes: person.title,
      })
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('id')
      .single();
    if (recordError || !record) fail(`employee record for ${email}`, recordError);
    members.push({ ...person, userId, employeeRecordId: record.id });
  }
  return members;
}

function scheduleFor(person: PersonSpec): Omit<Insert<'work_schedules'>, 'organization_id' | 'employee_record_id' | 'valid_from' | 'created_by'> {
  if (person.employment === 'minijob') return { monday_minutes: 200, tuesday_minutes: 0, wednesday_minutes: 200, thursday_minutes: 0, friday_minutes: 200, saturday_minutes: 0, sunday_minutes: 0 };
  if (person.employment === 'teilzeit') {
    const daily = Math.round((person.weeklyHours * 60) / 5);
    return { monday_minutes: daily, tuesday_minutes: daily, wednesday_minutes: daily, thursday_minutes: daily, friday_minutes: daily, saturday_minutes: 0, sunday_minutes: 0 };
  }
  return { monday_minutes: 510, tuesday_minutes: 510, wednesday_minutes: 510, thursday_minutes: 510, friday_minutes: 360, saturday_minutes: 0, sunday_minutes: 0 };
}

async function seedPersonnel(admin: Admin, organizationId: string, ownerId: string, members: Member[], random: Random): Promise<void> {
  await insertRows(admin, 'employment_conditions', members.map((member) => ({
    organization_id: organizationId, employee_record_id: member.employeeRecordId, valid_from: member.entryDate,
    employment_type: member.employment, weekly_hours: member.weeklyHours, vacation_days_per_year: member.vacationDays, created_by: ownerId,
  })));
  await insertRows(admin, 'work_schedules', members.map((member) => ({
    organization_id: organizationId, employee_record_id: member.employeeRecordId, valid_from: member.entryDate, created_by: ownerId, ...scheduleFor(member),
  })));

  const capabilityIds = new Map<string, string>();
  const capabilityRows: Insert<'organization_capabilities'>[] = [
    ...Object.entries(SKILLS).map(([name, description]) => ({ id: crypto.randomUUID(), organization_id: organizationId, kind: 'skill', name, description, default_expiry_warning_days: 0, created_by: ownerId, updated_by: ownerId })),
    ...Object.entries(CERTIFICATIONS).map(([name, spec]) => ({ id: crypto.randomUUID(), organization_id: organizationId, kind: 'certification', name, description: spec.description, default_expiry_warning_days: spec.warningDays, created_by: ownerId, updated_by: ownerId })),
  ];
  for (const row of capabilityRows) if (row.id) capabilityIds.set(row.name, row.id);
  await insertRows(admin, 'organization_capabilities', capabilityRows);

  const employeeCapabilities: Insert<'employee_capabilities'>[] = [];
  for (const member of members) {
    for (const skill of member.skills) {
      const capabilityId = capabilityIds.get(skill);
      if (!capabilityId) throw new Error(`unknown skill ${skill}`);
      employeeCapabilities.push({ organization_id: organizationId, employee_record_id: member.employeeRecordId, capability_id: capabilityId, capability_kind: 'skill', valid_from: member.entryDate, confirmation_status: 'unconfirmed', evidence_state: 'not_required', created_by: ownerId, updated_by: ownerId });
    }
    for (const certification of member.certifications) {
      const capabilityId = capabilityIds.get(certification);
      const spec = CERTIFICATIONS[certification];
      if (!capabilityId || !spec) throw new Error(`unknown certification ${certification}`);
      // A few certificates run out inside the data window so expiry warnings show up.
      const expiresSoon = random.chance(0.2);
      const validUntil = expiresSoon ? shiftDate(TODAY, random.int(10, 70)) : `${2027 + random.int(0, spec.validYears - 1)}-${String(random.int(1, 12)).padStart(2, '0')}-15`;
      const validFrom = shiftDate(validUntil, -365 * spec.validYears);
      employeeCapabilities.push({
        organization_id: organizationId, employee_record_id: member.employeeRecordId, capability_id: capabilityId, capability_kind: 'certification',
        valid_from: validFrom < member.entryDate ? member.entryDate : validFrom, valid_until: validUntil, renewal_due_date: shiftDate(validUntil, -30), issuer: spec.issuer,
        confirmation_status: 'confirmed', confirmed_by: ownerId, confirmed_at: berlinInstant('2026-08-03', '09:00'), evidence_state: 'received', created_by: ownerId, updated_by: ownerId,
      });
    }
  }
  await insertRows(admin, 'employee_capabilities', employeeCapabilities);

  const teamIds = new Map<TeamKey, string>();
  await insertRows(admin, 'teams', (Object.keys(TEAMS) as TeamKey[]).map((key) => {
    const id = crypto.randomUUID();
    teamIds.set(key, id);
    return { id, organization_id: organizationId, name: TEAMS[key].name, description: TEAMS[key].description, created_by: ownerId, updated_by: ownerId };
  }));
  await insertRows(admin, 'team_memberships', members.flatMap((member) => {
    const teamId = member.team ? teamIds.get(member.team) : undefined;
    if (!teamId) return [];
    return [{ organization_id: organizationId, team_id: teamId, employee_record_id: member.employeeRecordId, valid_from: member.entryDate > '2026-01-01' ? member.entryDate : '2026-01-01', created_by: ownerId }];
  }));
}

async function seedCustomers(admin: Admin, company: CompanySpec, organizationId: string, ownerId: string, random: Random): Promise<Customer[]> {
  const customers: Customer[] = [];
  const clientRows: Insert<'clients'>[] = [];
  const contactRows: Insert<'client_contacts'>[] = [];
  const siteRows: Insert<'client_sites'>[] = [];
  let customerNumber = 1001;
  const addAddress = (): { street: string; postalCode: string; address: string } => {
    const street = `${random.pick(company.streets)} ${random.int(1, 140)}`;
    const postalCode = random.pick(company.postalCodes);
    return { street, postalCode, address: `${street}, ${postalCode} ${company.city}` };
  };

  for (let index = 0; index < 26; index += 1) {
    const first = random.pick(PRIVATE_FIRST_NAMES);
    const last = PRIVATE_LAST_NAMES[index % PRIVATE_LAST_NAMES.length] ?? 'Meier';
    const { street, postalCode, address } = addAddress();
    const clientId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const email = `${slug(first)}.${slug(last)}@mail.example.com`;
    const phone = `${company.phonePrefix} ${random.int(10, 99)} ${random.int(100, 999)}`;
    clientRows.push({ id: clientId, organization_id: organizationId, name: `${first} ${last}`, client_type: 'privat', email, phone, address, customer_number: `K-${customerNumber}`, notes: random.chance(0.3) ? 'Schlüssel beim Nachbarn, bitte vorher anrufen.' : null });
    contactRows.push({ id: contactId, organization_id: organizationId, client_id: clientId, name: `${first} ${last}`, role: 'Eigentümer/in', email, phone, is_primary: true, created_by: ownerId });
    siteRows.push({ id: siteId, organization_id: organizationId, client_id: clientId, name: random.chance(0.7) ? 'Einfamilienhaus' : 'Wohnung', street, postal_code: postalCode, city: company.city, is_primary: true, primary_contact_id: contactId, access_notes: random.chance(0.4) ? 'Heizung im Keller, Zugang über den Hof.' : null, created_by: ownerId });
    customers.push({ id: clientId, name: `${first} ${last}`, type: 'privat', siteIds: [siteId], contactId, address });
    customerNumber += 1;
  }

  for (const commercial of COMMERCIAL_CLIENTS) {
    const clientId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const contactFirst = random.pick(PRIVATE_FIRST_NAMES);
    const contactLast = random.pick(PRIVATE_LAST_NAMES);
    const { address } = addAddress();
    const email = `info@${slug(commercial.name).slice(0, 18)}.example.com`;
    const phone = `${company.phonePrefix} ${random.int(10, 99)} ${random.int(1000, 9999)}`;
    clientRows.push({ id: clientId, organization_id: organizationId, name: commercial.name, client_type: 'gewerblich', email, phone, address, customer_number: `K-${customerNumber}`, notes: commercial.sites > 1 ? 'Rechnungen je Objekt getrennt ausstellen.' : null });
    contactRows.push({ id: contactId, organization_id: organizationId, client_id: clientId, name: `${contactFirst} ${contactLast}`, role: commercial.contact, email, phone, is_primary: true, created_by: ownerId });
    if (commercial.sites > 1) {
      contactRows.push({ organization_id: organizationId, client_id: clientId, name: `${random.pick(PRIVATE_FIRST_NAMES)} ${random.pick(PRIVATE_LAST_NAMES)}`, role: 'Hausmeister', phone: `0176 ${random.int(200, 999)} ${random.int(10000, 99999)}`, is_primary: false, created_by: ownerId });
    }
    const siteIds: string[] = [];
    for (let siteIndex = 0; siteIndex < commercial.sites; siteIndex += 1) {
      const siteId = crypto.randomUUID();
      const site = addAddress();
      siteIds.push(siteId);
      siteRows.push({ id: siteId, organization_id: organizationId, client_id: clientId, name: commercial.sites > 1 ? `Objekt ${site.street}` : 'Betriebsgebäude', street: site.street, postal_code: site.postalCode, city: company.city, is_primary: siteIndex === 0, primary_contact_id: contactId, access_notes: commercial.sites > 1 ? 'Schlüssel beim Hausmeister, Heizraum im Keller links.' : null, created_by: ownerId });
    }
    customers.push({ id: clientId, name: commercial.name, type: 'gewerblich', siteIds, contactId, address });
    customerNumber += 1;
  }

  await insertRows(admin, 'clients', clientRows);
  await insertRows(admin, 'client_contacts', contactRows);
  await insertRows(admin, 'client_sites', siteRows);
  return customers;
}

type Absences = { isAbsent: (member: Member, date: string) => boolean };

async function seedAbsences(admin: Admin, organizationId: string, ownerId: string, members: Member[], holidays: Set<string>): Promise<Absences> {
  const absent = new Set<string>();
  const employees = members.filter((member) => member.role !== 'admin');
  const at = (index: number): Member => {
    const member = employees[index % employees.length];
    if (!member) throw new Error('no employees');
    return member;
  };
  const countDays = (from: string, to: string): number => listWorkdays(from, to, holidays).length;
  const markAbsent = (member: Member, from: string, to: string): void => {
    for (let date = from; date <= to; date = shiftDate(date, 1)) absent.add(`${member.employeeRecordId}:${date}`);
  };

  const approved: Array<[number, string, string]> = [[2, '2026-08-10', '2026-08-14'], [3, '2026-08-24', '2026-09-04'], [5, '2026-09-07', '2026-09-11'], [1, '2026-10-05', '2026-10-09'], [0, '2026-10-19', '2026-10-23'], [6, '2026-11-02', '2026-11-06'], [4, '2026-11-23', '2026-11-27']];
  const pending: Array<[number, string, string]> = [[7, '2026-11-09', '2026-11-13'], [8, '2026-10-26', '2026-10-27']];
  const vacationRows: Insert<'vacation_requests'>[] = [];
  for (const [index, from, to] of approved) {
    const member = at(index);
    markAbsent(member, from, to);
    vacationRows.push({ organization_id: organizationId, employee_record_id: member.employeeRecordId, requested_by: member.userId, start_date: from, end_date: to, day_portion: 'full', status: 'approved', comment: 'Familienurlaub', decided_by: ownerId, decided_at: berlinInstant(shiftDate(from, -21), '10:00'), approved_days_by_year: { '2026': countDays(from, to) } });
  }
  for (const [index, from, to] of pending) {
    const member = at(index);
    vacationRows.push({ organization_id: organizationId, employee_record_id: member.employeeRecordId, requested_by: member.userId, start_date: from, end_date: to, day_portion: 'full', status: 'pending', comment: 'Resturlaub' });
  }
  await insertRows(admin, 'vacation_requests', vacationRows);

  const sickness: Array<[number, string, string, boolean, 'pending' | 'received' | 'not_required']> = [[1, '2026-08-17', '2026-08-19', true, 'received'], [6, '2026-09-02', '2026-09-03', false, 'not_required'], [2, '2026-09-14', '2026-09-16', true, 'pending'], [8, '2026-08-31', '2026-08-31', false, 'not_required']];
  const sicknessRows: Insert<'sickness_reports'>[] = [];
  for (const [index, from, to, evidenceRequired, evidenceStatus] of sickness) {
    const member = at(index);
    markAbsent(member, from, to);
    sicknessRows.push({ organization_id: organizationId, employee_record_id: member.employeeRecordId, absence_type: 'krankheit', start_date: from, end_date: to, day_portion: 'full', status: 'reported', evidence_required: evidenceRequired, evidence_status: evidenceStatus, reported_by: member.userId });
  }
  await insertRows(admin, 'sickness_reports', sicknessRows);
  return { isAbsent: (member, date) => absent.has(`${member.employeeRecordId}:${date}`) };
}

async function seedInventory(admin: Admin, company: CompanySpec, organizationId: string, ownerId: string, random: Random): Promise<{ itemIds: Map<string, string>; mainLocationId: string }> {
  const { data: categories, error: categoriesError } = await admin.from('inventory_categories').select('id, name').eq('organization_id', organizationId);
  if (categoriesError) fail('load inventory categories', categoriesError);
  const categoryFor = (key: string): string | null => {
    const needles: Record<string, string[]> = { rohr: ['rohr'], fitting: ['fitting', 'verbind'], armatur: ['armatur'], sanitaer: ['sanit'], heizung: ['heiz'], lueftung: ['lüft', 'klima'], verbrauch: ['verbrauch', 'kleinteil'], werkzeug: ['werkzeug'] };
    const match = (categories ?? []).find((category) => (needles[key] ?? []).some((needle) => category.name.toLowerCase().includes(needle)));
    return match?.id ?? categories?.[0]?.id ?? null;
  };

  const supplierIds: string[] = [];
  await insertRows(admin, 'inventory_suppliers', SUPPLIERS.map((supplier) => {
    const id = crypto.randomUUID();
    supplierIds.push(id);
    return { id, organization_id: organizationId, name: supplier.name, customer_number: supplier.customerNumber, email: supplier.email, phone: supplier.phone };
  }));

  const mainLocationId = crypto.randomUUID();
  const vehicleIds: string[] = [];
  const locationRows: Insert<'inventory_locations'>[] = [
    { id: mainLocationId, organization_id: organizationId, name: 'Hauptlager', description: 'Lager im Betriebshof', location_type: 'storage', sort_order: 0, created_by: ownerId },
    { organization_id: organizationId, parent_location_id: mainLocationId, name: 'Regal Heizung', location_type: 'shelf', sort_order: 1, created_by: ownerId },
    { organization_id: organizationId, parent_location_id: mainLocationId, name: 'Regal Sanitär', location_type: 'shelf', sort_order: 2, created_by: ownerId },
  ];
  for (let index = 1; index <= 4; index += 1) {
    const id = crypto.randomUUID();
    vehicleIds.push(id);
    locationRows.push({ id, organization_id: organizationId, name: `Transporter ${index} (${company.plate} ${random.int(100, 999)})`, description: index <= 2 ? 'Kundendienstfahrzeug' : 'Montagefahrzeug', location_type: 'vehicle', sort_order: 10 + index, created_by: ownerId });
  }
  await insertRows(admin, 'inventory_locations', locationRows);

  const itemIds = new Map<string, string>();
  await insertRows(admin, 'inventory_items', ITEMS.map((item, index) => {
    const id = crypto.randomUUID();
    itemIds.set(item.name, id);
    return {
      id, organization_id: organizationId, item_type: item.type, name: item.name, unit: item.unit, category_id: categoryFor(item.category), internal_sku: `${company.key.slice(0, 2).toUpperCase()}-${String(index + 1).padStart(4, '0')}`,
      supplier_id: supplierIds[index % supplierIds.length] ?? null, supplier_article_number: String(random.int(100000, 999999)), purchase_price_cents: item.purchase, sale_price_cents: item.sale > 0 ? item.sale : null,
      currency_code: 'EUR', tax_rate_basis_points: 1900, is_billable: item.type !== 'tool', global_minimum_stock: item.minimum, global_target_stock: item.initial, track_quantity: true, track_individual_assets: false, is_active: true, created_by: ownerId,
    };
  }));

  for (const item of ITEMS) {
    const itemId = itemIds.get(item.name);
    if (!itemId) continue;
    const { error } = await admin.rpc('record_inventory_movement', { p_organization_id: organizationId, p_actor_id: ownerId, p_item_id: itemId, p_location_id: mainLocationId, p_movement_type: 'initial_count', p_quantity_delta: item.initial, p_reason: 'Anfangsbestand Inventur August 2026' });
    if (error) fail(`initial count ${item.name}`, error);
    if (item.type === 'material' && item.initial >= 10) {
      const vehicleId = vehicleIds[random.int(0, 1)];
      if (!vehicleId) continue;
      const { error: vehicleError } = await admin.rpc('record_inventory_movement', { p_organization_id: organizationId, p_actor_id: ownerId, p_item_id: itemId, p_location_id: vehicleId, p_movement_type: 'stock_in', p_quantity_delta: Math.max(1, Math.floor(item.initial / 10)), p_reason: 'Fahrzeugbestand aufgefüllt' });
      if (vehicleError) fail(`vehicle stock ${item.name}`, vehicleError);
    }
  }
  return { itemIds, mainLocationId };
}

async function seedWorkTemplates(admin: Admin, organizationId: string, ownerId: string): Promise<Map<string, string>> {
  const publishedVersionByName = new Map<string, string>();
  for (const template of TEMPLATES) {
    const { data: templateId, error } = await admin.rpc('create_work_template', { p_organization_id: organizationId, p_target_type: 'job', p_name: template.name, p_actor_id: ownerId, p_description: template.description });
    if (error || !templateId) fail(`create template ${template.name}`, error);
    const { data: row, error: rowError } = await admin.from('work_templates').select('draft_version_id').eq('id', templateId).single();
    if (rowError || !row?.draft_version_id) fail(`draft version of ${template.name}`, rowError);
    const versionId = row.draft_version_id;
    await insertRows(admin, 'work_template_items', template.items.map(([content, kind, group], index) => ({ organization_id: organizationId, version_id: versionId, item_kind: kind, content, requirement_state: 'required', group_label: group, sort_order: index, created_by: ownerId })));
    const { data: publishedId, error: publishError } = await admin.rpc('publish_work_template', { p_organization_id: organizationId, p_template_id: templateId, p_actor_id: ownerId });
    if (publishError || !publishedId) fail(`publish template ${template.name}`, publishError);
    publishedVersionByName.set(template.name, publishedId);
  }
  return publishedVersionByName;
}

async function seedEquipment(admin: Admin, organizationId: string, ownerId: string, customers: Customer[], random: Random): Promise<Map<string, string[]>> {
  const equipmentBySite = new Map<string, string[]>();
  const targets = customers.filter((customer) => customer.type === 'privat').slice(0, 16).concat(customers.filter((customer) => customer.type === 'gewerblich').slice(0, 8));
  for (const customer of targets) {
    const siteId = customer.siteIds[0];
    if (!siteId) continue;
    const kinds = [random.pick(EQUIPMENT_KINDS.slice(0, 8))];
    if (random.chance(0.5)) kinds.push(random.pick(EQUIPMENT_KINDS.slice(8)));
    for (const kind of kinds) {
      const equipmentId = crypto.randomUUID();
      const year = random.int(kind.year[0], kind.year[1]);
      const installationDate = `${year}-${String(random.int(1, 12)).padStart(2, '0')}-${String(random.int(1, 28)).padStart(2, '0')}`;
      const payload = {
        clientId: customer.id, siteId, name: `${kind.name} ${kind.manufacturer}`, category: kind.category, subtype: kind.subtype, manufacturer: kind.manufacturer, model: kind.model,
        locationDetail: random.pick(['Keller, Heizraum', 'Hauswirtschaftsraum', 'Dachboden', 'Küche', 'Technikraum EG']), state: 'active', installationDate, commissioningDate: installationDate,
        identifiers: [{ identifierType: 'serial_number', value: `${kind.manufacturer.slice(0, 2).toUpperCase()}${random.int(1000000, 9999999)}` }],
        warrantyProvider: year >= 2024 ? kind.manufacturer : null, warrantyEndDate: year >= 2024 ? `${year + 2}-12-31` : null, reason: 'Bestandsaufnahme',
      };
      const { error } = await admin.rpc('create_installed_equipment', { p_organization_id: organizationId, p_equipment_id: equipmentId, p_payload: payload as Json, p_actor_id: ownerId, p_idempotency_key: crypto.randomUUID() });
      if (error) fail(`equipment ${kind.model} for ${customer.name}`, error);
      equipmentBySite.set(siteId, [...(equipmentBySite.get(siteId) ?? []), equipmentId]);
    }
  }
  return equipmentBySite;
}

async function seedWork(admin: Admin, organizationId: string, ownerId: string, members: Member[], customers: Customer[], workdays: string[], absences: Absences, random: Random): Promise<SeededJob[]> {
  const fieldWorkers = members.filter((member) => member.field && member.employment !== 'minijob');
  // Jobs per member and day; at most two, so every past job gets a clock-in or a break-end entry.
  const load = new Map<string, number>();
  const crewFor = (kind: JobKind, date: string | null): Member[] => {
    const preferred = fieldWorkers.filter((member) => member.team === kind.team || member.team === 'service');
    const pool = [...preferred, ...fieldWorkers.filter((member) => !preferred.includes(member))];
    if (!date) return pool.slice(0, kind.crew);
    const present = pool.filter((member) => !absences.isAbsent(member, date));
    const ranked = [...present.filter((member) => (load.get(`${member.employeeRecordId}:${date}`) ?? 0) === 0), ...present.filter((member) => (load.get(`${member.employeeRecordId}:${date}`) ?? 0) === 1)];
    const crew = ranked.slice(0, kind.crew);
    for (const member of crew) load.set(`${member.employeeRecordId}:${date}`, (load.get(`${member.employeeRecordId}:${date}`) ?? 0) + 1);
    return crew;
  };
  const phaseFor = (date: string | null): SeededJob['phase'] => {
    if (!date) return 'parked';
    if (date < '2026-09-16') return 'done';
    if (date <= TODAY) return 'active';
    return 'planned';
  };

  const jobs: SeededJob[] = [];
  const jobRows: Insert<'jobs'>[] = [];
  let jobNumber = 1;
  const pushJob = (kind: JobKind, customer: Customer, date: string | null, time: string | null, projectId: string | null, titleOverride?: string): SeededJob => {
    const siteId = customer.siteIds[random.int(0, customer.siteIds.length - 1)] ?? customer.siteIds[0];
    if (!siteId) throw new Error('customer without site');
    const id = crypto.randomUUID();
    const phase = phaseFor(date);
    const job: SeededJob = { id, title: titleOverride ?? kind.title, kind, plannedDate: date, assignees: crewFor(kind, date), phase, clientId: customer.id, siteId, contactId: customer.contactId };
    jobs.push(job);
    jobRows.push({
      id, organization_id: organizationId, project_id: projectId, client_id: customer.id, site_id: siteId, contact_id: customer.contactId, job_number: `AUF-2026-${String(jobNumber).padStart(3, '0')}`,
      title: job.title, description: kind.description, status: phase === 'parked' ? 'geparkt' : 'nicht_bearbeitet', priority: kind.minutes >= 480 ? 'mittel' : random.pick(['niedrig', 'mittel', 'mittel', 'hoch']),
      planned_date: date, planned_time: time, estimated_duration_minutes: Math.min(kind.minutes, 480), planned_working_minutes: kind.minutes * kind.crew, location: customer.address, created_by: ownerId,
      created_at: berlinInstant(shiftDate(date ?? RANGE_START, -random.int(3, 14)), '09:30'),
    });
    jobNumber += 1;
    return job;
  };

  // Projects: five per organization, staggered so two are finished, two are running and one starts in November.
  const projectRows: Insert<'projects'>[] = [];
  const projectStarts = ['2026-08-03', '2026-08-17', '2026-09-07', '2026-10-05', '2026-11-02'];
  const commercial = customers.filter((customer) => customer.type === 'gewerblich');
  const privateCustomers = customers.filter((customer) => customer.type === 'privat');
  PROJECT_KINDS.forEach((kind, index) => {
    const customer = kind.name.includes('Mehrfamilienhaus') ? (commercial[0] ?? customers[0]) : privateCustomers[index + 3];
    if (!customer) throw new Error('missing project customer');
    const start = projectStarts[index] ?? '2026-08-03';
    const projectId = crypto.randomUUID();
    const end = shiftDate(start, kind.weeks * 7 - 3);
    projectRows.push({ id: projectId, organization_id: organizationId, client_id: customer.id, site_id: customer.siteIds[0] ?? null, contact_id: customer.contactId, name: `${kind.name} ${customer.name.split(' ').slice(-1)[0] ?? ''}`.trim(), description: kind.description, project_number: `PRJ-2026-${String(index + 1).padStart(3, '0')}`, planned_start_date: start, planned_end_date: end, created_by: ownerId });
    const projectWorkdays = listWorkdays(start, end, new Set()).filter((date) => workdays.includes(date));
    kind.jobs.forEach((jobKind, jobIndex) => {
      const slot = Math.min(projectWorkdays.length - 1, Math.floor((jobIndex / kind.jobs.length) * projectWorkdays.length));
      const date = projectWorkdays[slot] ?? start;
      pushJob(jobKind, customer, date, '07:30', projectId);
    });
  });
  await insertRows(admin, 'projects', projectRows);

  // Standalone service jobs across the whole window, roughly 1.3 per workday.
  const times = ['07:30', '08:00', '09:30', '11:00', '13:00', '14:30'];
  for (const date of workdays) {
    const count = random.chance(0.35) ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const kind = random.pick(SERVICE_JOBS);
      const customer = random.chance(0.7) ? random.pick(privateCustomers) : random.pick(commercial);
      pushJob(kind, customer, date, times[(index * 2 + random.int(0, 1)) % times.length] ?? '08:00', null);
    }
  }
  // Parked work without a date.
  const parked: Array<[string, Customer[]]> = [['Heizkörper austauschen, wartet auf Materialfreigabe', privateCustomers], ['Hydraulischer Abgleich, Termin mit Hausverwaltung offen', commercial]];
  for (const [title, pool] of parked) {
    const kind = SERVICE_JOBS.find((candidate) => title.startsWith(candidate.title));
    if (!kind) throw new Error(`no job kind for ${title}`);
    pushJob(kind, random.pick(pool), null, null, null, title);
  }

  await insertRows(admin, 'jobs', jobRows);
  await insertRows(admin, 'job_assignments', jobs.flatMap((job) => job.assignees.map((member) => ({ job_id: job.id, user_id: member.userId, assigned_by: ownerId, organization_id: organizationId, assigned_at: berlinInstant(shiftDate(job.plannedDate ?? '2026-08-03', -2), '16:00') }))));
  return jobs;
}

async function seedTimeEntries(admin: Admin, organizationId: string, members: Member[], jobs: SeededJob[], workdays: string[], absences: Absences, random: Random): Promise<void> {
  const jobsByMemberDay = new Map<string, SeededJob[]>();
  for (const job of jobs) {
    if (!job.plannedDate || job.plannedDate > TODAY) continue;
    for (const member of job.assignees) {
      const key = `${member.employeeRecordId}:${job.plannedDate}`;
      jobsByMemberDay.set(key, [...(jobsByMemberDay.get(key) ?? []), job]);
    }
  }
  const rows: Insert<'time_entries'>[] = [];
  const pastWorkdays = workdays.filter((date) => date <= TODAY);
  const recentWorkdays = pastWorkdays.slice(-8);
  let pendingSequence = 0;
  for (const member of members) {
    const schedule = scheduleFor(member);
    const minutesByWeekday = [schedule.sunday_minutes, schedule.monday_minutes, schedule.tuesday_minutes, schedule.wednesday_minutes, schedule.thursday_minutes, schedule.friday_minutes, schedule.saturday_minutes];
    // One day per field worker still awaits approval, entered by hand that evening.
    // The rows of one submission share a created_at, as the manual entry form writes them.
    const pendingDay = member.field ? random.pick(recentWorkdays) : null;
    for (const date of pastWorkdays) {
      if (date < member.entryDate || absences.isAbsent(member, date)) continue;
      const target = minutesByWeekday[weekday(date)] ?? 0;
      if (target === 0) continue;
      const isPending = date === pendingDay;
      const status: Database['public']['Enums']['time_entry_status'] = isPending ? 'pending' : 'approved';
      pendingSequence += isPending ? 1 : 0;
      const createdAt = isPending ? berlinInstant(date, minutesToClock(17 * 60 + 30 + pendingSequence)) : berlinInstant(date, '20:00');
      const start = (member.field ? 6 * 60 + 45 : 8 * 60) + random.int(0, 20);
      const worked = target + random.int(-15, 35);
      const hasBreak = worked > 300;
      const end = start + worked + (hasBreak ? 30 : 0);
      const dayJobs = jobsByMemberDay.get(`${member.employeeRecordId}:${date}`) ?? [];
      const base = { organization_id: organizationId, user_id: member.userId, is_manual: true, status, capture_source: 'employee' as const, created_at: createdAt };
      rows.push({ ...base, entry_type: 'clock_in', timestamp: berlinInstant(date, minutesToClock(start)), job_id: dayJobs[0]?.id ?? null });
      if (hasBreak) {
        rows.push({ ...base, entry_type: 'break_start', timestamp: berlinInstant(date, minutesToClock(start + Math.floor(worked / 2))) });
        rows.push({ ...base, entry_type: 'break_end', timestamp: berlinInstant(date, minutesToClock(start + Math.floor(worked / 2) + 30)), job_id: dayJobs[1]?.id ?? dayJobs[0]?.id ?? null });
      }
      rows.push({ ...base, entry_type: 'clock_out', timestamp: berlinInstant(date, minutesToClock(end)) });
    }
  }
  rows.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  await insertRows(admin, 'time_entries', rows, 200);
  log(`  time entries: ${rows.length}`);
}

async function finishJobs(admin: Admin, organizationId: string, ownerId: string, jobs: SeededJob[]): Promise<void> {
  const { data: rows, error } = await admin.from('jobs').select('id, execution_version').eq('organization_id', organizationId);
  if (error) fail('load job versions', error);
  const versions = new Map((rows ?? []).map((row) => [row.id, row.execution_version]));
  let completed = 0;
  for (const job of jobs) {
    if (job.phase === 'done') {
      const { error: transitionError } = await admin.rpc('transition_work_execution', { p_organization_id: organizationId, p_actor_id: ownerId, p_target_type: 'job', p_target_id: job.id, p_expected_version: versions.get(job.id) ?? 0, p_to_state: 'execution_complete', p_reason: 'Abgeschlossen laut Montagebericht', p_override_gates: true });
      if (transitionError) fail(`complete job ${job.title}`, transitionError);
      const { error: updateError } = await admin.from('jobs').update({ status: 'fertig', actual_completion_date: job.plannedDate }).eq('id', job.id);
      if (updateError) fail(`mark job ${job.title} fertig`, updateError);
      completed += 1;
    } else if (job.phase === 'active') {
      const { error: updateError } = await admin.from('jobs').update({ status: 'in_bearbeitung' }).eq('id', job.id);
      if (updateError) fail(`mark job ${job.title} in_bearbeitung`, updateError);
    }
  }
  log(`  jobs: ${jobs.length} (${completed} completed)`);
}

async function seedMaterialLines(admin: Admin, organizationId: string, ownerId: string, jobs: SeededJob[], itemIds: Map<string, string>, mainLocationId: string, random: Random): Promise<void> {
  let lines = 0;
  const remaining = new Map(ITEMS.map((item) => [item.name, item.initial]));
  for (const job of jobs) {
    if (job.kind.materials.length === 0 || (job.phase === 'done' && random.chance(0.4))) continue;
    for (const [itemName, quantity] of job.kind.materials) {
      const itemId = itemIds.get(itemName);
      if (!itemId) throw new Error(`unknown item ${itemName}`);
      const lineId = crypto.randomUUID();
      await insertRows(admin, 'job_material_lines', [{ id: lineId, organization_id: organizationId, job_id: job.id, item_id: itemId, preferred_location_id: mainLocationId, planned_quantity: quantity, is_billable: true, status: 'planned', created_by: ownerId }]);
      lines += 1;
      const stock = remaining.get(itemName) ?? 0;
      if (job.phase !== 'done' || stock < quantity) continue;
      remaining.set(itemName, stock - quantity);
      const { error } = await admin.rpc('record_inventory_movement', { p_organization_id: organizationId, p_actor_id: job.assignees[0]?.userId ?? ownerId, p_item_id: itemId, p_location_id: mainLocationId, p_movement_type: 'job_take', p_quantity_delta: -quantity, p_job_id: job.id, p_job_material_line_id: lineId });
      if (error) fail(`job take ${itemName} for ${job.title}`, error);
    }
  }
  log(`  material lines: ${lines}`);
}

async function seedRequests(admin: Admin, organizationId: string, ownerId: string, members: Member[], customers: Customer[], jobs: SeededJob[], equipmentBySite: Map<string, string[]>, random: Random): Promise<void> {
  const office = members.find((member) => member.role === 'buero') ?? members[0];
  if (!office) throw new Error('no office member');
  const rows: Insert<'client_requests'>[] = [];
  const conversions: Array<{ requestId: string; spec: RequestSpec; customer: Customer }> = [];
  REQUESTS.forEach((spec, index) => {
    const customer = customers[(index * 3) % customers.length];
    if (!customer) throw new Error('missing request customer');
    const id = crypto.randomUUID();
    const receivedAt = berlinInstant(spec.receivedAt.slice(0, 10), spec.receivedAt.slice(11));
    const row: Insert<'client_requests'> = {
      id, organization_id: organizationId, request_number: `ANF-2026-${String(index + 1).padStart(3, '0')}`, client_id: customer.id, contact_id: customer.contactId, site_id: customer.siteIds[0] ?? null,
      caller_name: customer.name, summary: spec.summary, details: spec.details, category: spec.category, urgency: spec.urgency, source: spec.source, status: 'offen', received_at: receivedAt, created_by: office.userId, created_at: receivedAt,
    };
    if (spec.outcome === 'in_klaerung') { row.status = 'in_klaerung'; row.assigned_to = office.userId; }
    if (spec.outcome === 'geschlossen') { row.status = 'geschlossen'; row.closed_reason = random.pick(['kein_bedarf', 'anderweitig_geloest']); row.closed_note = 'Telefonisch geklärt, kein Einsatz nötig.'; row.closed_by = office.userId; row.closed_at = berlinInstant(shiftDate(spec.receivedAt.slice(0, 10), 1), '10:00'); }
    if (spec.outcome === 'job') {
      const job = jobs.find((candidate) => candidate.clientId === customer.id && candidate.plannedDate && candidate.plannedDate > spec.receivedAt.slice(0, 10)) ?? jobs.find((candidate) => candidate.plannedDate && candidate.plannedDate > spec.receivedAt.slice(0, 10));
      if (job) { row.status = 'umgewandelt'; row.converted_job_id = job.id; row.converted_by = office.userId; row.converted_at = berlinInstant(shiftDate(spec.receivedAt.slice(0, 10), 1), '11:00'); }
    }
    if (spec.outcome === 'service_case') conversions.push({ requestId: id, spec, customer });
    rows.push(row);
  });
  await insertRows(admin, 'client_requests', rows);

  for (const conversion of conversions) {
    const siteId = conversion.customer.siteIds[0];
    const payload = { sourceRequestId: conversion.requestId, chargeContext: conversion.spec.category === 'garantie_mangel' ? 'suspected_warranty' : 'expected_chargeable', equipmentIds: siteId ? (equipmentBySite.get(siteId) ?? []).slice(0, 1) : [], triageNote: 'Rückruf erfolgt, Einsatz wird disponiert.' };
    const { error } = await admin.rpc('create_service_case', { p_organization_id: organizationId, p_service_case_id: crypto.randomUUID(), p_payload: payload as Json, p_actor_id: ownerId, p_idempotency_key: crypto.randomUUID() });
    if (error) fail(`service case from request ${conversion.spec.summary}`, error);
  }

  const directCases: Array<[string, string, Database['public']['Enums']['request_urgency']]> = [
    ['Heizung fällt nachts aus', 'Therme geht nachts auf Störung und startet morgens wieder, kein Fehlercode im Display.', 'hoch'],
    ['Wärmepumpe erreicht Solltemperatur nicht', 'Vorlauf bleibt bei 35 Grad, Kunde friert seit dem Wochenende.', 'hoch'],
    ['Warmwasserspeicher tropft am Anschluss', 'Feuchte Stelle unter dem Speicher, Kunde hat Eimer untergestellt.', 'normal'],
    ['Lüftungsanlage pfeift', 'Seit dem Filterwechsel ein Pfeifgeräusch, vermutlich Bypass-Klappe.', 'niedrig'],
    ['Hebeanlage läuft dauernd', 'Pumpe schaltet nicht ab, Rückstau im Keller befürchtet.', 'hoch'],
    ['Solaranlage zeigt Fehler Kollektorfühler', 'Regler meldet Fühlerbruch, Anlage steht.', 'normal'],
  ];
  const targets = customers.filter((customer) => customer.siteIds[0] && equipmentBySite.has(customer.siteIds[0]));
  for (const [index, [summary, statement, urgency]] of directCases.entries()) {
    const customer = targets[(index * 2) % targets.length];
    const siteId = customer?.siteIds[0];
    if (!customer || !siteId) continue;
    const payload = { clientId: customer.id, contactId: customer.contactId, siteId, originalStatement: statement, summary, urgency, chargeContext: index % 3 === 0 ? 'suspected_contract' : 'unknown', equipmentIds: (equipmentBySite.get(siteId) ?? []).slice(0, 1), accessInstructions: 'Bitte vorher anrufen.' };
    const { error } = await admin.rpc('create_service_case', { p_organization_id: organizationId, p_service_case_id: crypto.randomUUID(), p_payload: payload as Json, p_actor_id: ownerId, p_idempotency_key: crypto.randomUUID() });
    if (error) fail(`service case ${summary}`, error);
  }
  log(`  requests: ${rows.length}, service cases: ${conversions.length + directCases.length}`);
}

async function seedMaintenance(admin: Admin, organizationId: string, ownerId: string, customers: Customer[], equipmentBySite: Map<string, string[]>, templateVersions: Map<string, string>): Promise<void> {
  const gasTemplate = templateVersions.get('Wartung Gas-Brennwerttherme');
  const heatPumpTemplate = templateVersions.get('Wartung Wärmepumpe');
  if (!gasTemplate || !heatPumpTemplate) throw new Error('maintenance templates missing');
  const targets = customers.filter((customer) => customer.siteIds[0] && (equipmentBySite.get(customer.siteIds[0]) ?? []).length > 0).slice(0, 6);
  let plans = 0;
  for (const [index, customer] of targets.entries()) {
    const siteId = customer.siteIds[0];
    const equipmentIds = siteId ? (equipmentBySite.get(siteId) ?? []) : [];
    if (!siteId || equipmentIds.length === 0) continue;
    const coverageId = crypto.randomUUID();
    const coveragePayload = { clientId: customer.id, siteId, reference: `WV-2026-${String(index + 1).padStart(3, '0')}`, description: `Wartungsvertrag ${customer.name}: jährliche Wartung der Heizungsanlage, Anfahrt inklusive`, status: 'active', validFrom: '2026-01-01', validUntil: '2027-12-31', noticeDate: '2027-09-30', renewalDate: '2028-01-01', reviewDueDate: '2027-10-15', operationalNote: 'Terminabsprache mindestens zwei Wochen vorher.' };
    const { error: coverageError } = await admin.rpc('create_maintenance_coverage', { p_organization_id: organizationId, p_maintenance_coverage_id: coverageId, p_payload: coveragePayload as Json, p_actor_id: ownerId, p_idempotency_key: crypto.randomUUID() });
    if (coverageError) fail(`coverage for ${customer.name}`, coverageError);
    const dueMonth = 10 + (index % 2);
    const planPayload = {
      clientId: customer.id, siteId, maintenanceCoverageId: coverageId, status: 'active', templateVersionId: index % 3 === 2 ? heatPumpTemplate : gasTemplate, equipmentIds: equipmentIds.slice(0, 1),
      effectiveFromDate: '2026-08-01', firstDueDate: `2026-${dueMonth}-${String(6 + index * 3).padStart(2, '0')}`, intervalMonths: 12, dueWindowBeforeDays: 14, dueWindowAfterDays: 14, plannedDurationMinutes: index % 3 === 2 ? 120 : 90, nextDueBasis: 'planned_due_date',
      operationalInstructions: 'Wartungsprotokoll an die Hausverwaltung senden.', reason: 'Wartungsplan aus Vertrag angelegt',
    };
    const { error: planError } = await admin.rpc('create_maintenance_plan', { p_organization_id: organizationId, p_maintenance_plan_id: crypto.randomUUID(), p_revision_id: crypto.randomUUID(), p_payload: planPayload as Json, p_actor_id: ownerId, p_idempotency_key: crypto.randomUUID() });
    if (planError) fail(`maintenance plan for ${customer.name}`, planError);
    plans += 1;
  }
  log(`  maintenance coverages and plans: ${plans}`);
}

async function seedDispatches(admin: Admin, organizationId: string, ownerId: string, jobs: SeededJob[]): Promise<void> {
  const upcoming = jobs.filter((job) => job.plannedDate && job.plannedDate > TODAY && job.plannedDate <= shiftDate(TODAY, 14) && job.assignees.length > 0);
  if (upcoming.length === 0) return;
  const { data: occurrences, error } = await admin.from('planning_occurrences').select('id, job_id').eq('organization_id', organizationId).eq('status', 'scheduled').in('job_id', upcoming.map((job) => job.id));
  if (error) fail('load occurrences', error);
  let issued = 0;
  for (const occurrence of occurrences ?? []) {
    const { error: dispatchError } = await admin.rpc('issue_planning_dispatch', { p_organization_id: organizationId, p_actor_id: ownerId, p_occurrence_id: occurrence.id, p_note: 'Bitte Material am Vorabend laden.', p_request_id: crypto.randomUUID() });
    if (dispatchError) fail(`dispatch for occurrence ${occurrence.id}`, dispatchError);
    issued += 1;
  }
  log(`  dispatches issued: ${issued}`);
}

async function seedCompany(admin: Admin, owner: { id: string }, company: CompanySpec): Promise<void> {
  const random = createRandom(company.seed);
  const holidays = new Set(getPublicHolidaysForYear(company.region, 2026).map((holiday) => holiday.date));
  const workdays = listWorkdays(RANGE_START, RANGE_END, holidays);
  const organizationId = crypto.randomUUID();
  log(`seed: creating "${company.name}" (${organizationId})`);

  await insertRows(admin, 'organizations', [{ id: organizationId, name: company.name, admin_id: owner.id, unique_code: randomOrganizationCode(random) }]);
  await insertRows(admin, 'organization_settings', [{ organization_id: organizationId, break_mode: 'manual', auto_break_threshold_minutes: 360, auto_break_duration_minutes: 30, break_policy_history: [], holiday_region: company.region }]);
  const { error: ownerRecordError } = await admin.from('employee_records').update({ employee_number: 'MA-001', notes: 'Inhaber' }).eq('organization_id', organizationId).eq('user_id', owner.id);
  if (ownerRecordError) fail('owner employee record', ownerRecordError);

  const members = await createMembers(admin, company, organizationId, random);
  await seedPersonnel(admin, organizationId, owner.id, members, random);
  log(`  members: ${members.length + 1}`);
  const customers = await seedCustomers(admin, company, organizationId, owner.id, random);
  log(`  customers: ${customers.length}`);
  const absences = await seedAbsences(admin, organizationId, owner.id, members, holidays);
  const { itemIds, mainLocationId } = await seedInventory(admin, company, organizationId, owner.id, random);
  log(`  inventory items: ${itemIds.size}`);
  const templateVersions = await seedWorkTemplates(admin, organizationId, owner.id);
  const equipmentBySite = await seedEquipment(admin, organizationId, owner.id, customers, random);
  log(`  installed equipment sites: ${equipmentBySite.size}`);
  const jobs = await seedWork(admin, organizationId, owner.id, members, customers, workdays, absences, random);
  await seedTimeEntries(admin, organizationId, members, jobs, workdays, absences, random);
  await finishJobs(admin, organizationId, owner.id, jobs);
  await seedMaterialLines(admin, organizationId, owner.id, jobs, itemIds, mainLocationId, random);
  await seedRequests(admin, organizationId, owner.id, members, customers, jobs, equipmentBySite, random);
  await seedMaintenance(admin, organizationId, owner.id, customers, equipmentBySite, templateVersions);
  await seedDispatches(admin, organizationId, owner.id, jobs);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const readFlag = (name: string): string | null => {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  };
  const target = readFlag('--target');
  if (target !== 'dev' && target !== 'prod') throw new Error('Usage: bun scripts/seed-demo-data.ts --target dev|prod [--phase reset|seed] [--confirm-prod]');
  if (target === 'prod' && !args.includes('--confirm-prod')) throw new Error('PROD needs --confirm-prod');
  const phase = readFlag('--phase') ?? 'all';

  const { url, secretKey } = loadEnvironment(target);
  const admin = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = await findOwner(admin);
  log(`target ${target} (${url}), owner ${OWNER_EMAIL} = ${owner.id}`);

  if (phase === 'all' || phase === 'reset') await resetOwnerOrganizations(admin, owner.id);
  if (phase === 'all' || phase === 'seed') {
    const { count } = await admin.from('organizations').select('id', { count: 'exact', head: true }).eq('admin_id', owner.id);
    if ((count ?? 0) > 0) throw new Error('owner still owns organizations; run the reset phase first');
    for (const company of COMPANIES) await seedCompany(admin, owner, company);
  }
  log('done');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
