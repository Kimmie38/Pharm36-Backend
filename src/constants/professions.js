// Mirrors src/data/mockData.js in the mobile app. This is now the single source of truth;
// the app can fetch it from GET /api/meta instead of hard-coding it.

const professionalTypes = {
  pharmacist: {
    key: 'pharmacist',
    label: 'Pharmacist',
    council: 'Pharmacists Council of Nigeria',
    councilShort: 'PCN',
    licensePrefix: 'PCN',
    sections: [
      { key: 'general_pharmacy', label: 'General / Community Pharmacy', description: 'Standard retail & OTC medicines' },
      { key: 'hospital_pharmacy', label: 'Hospital Pharmacy', description: 'Clinical & hospital-dispensed medicines' },
      { key: 'controlled_drugs', label: 'Controlled Drugs & Narcotics', description: 'Schedule drugs requiring extra PCN authorization' },
      { key: 'veterinary_pharmacy', label: 'Veterinary Pharmacy (cross-licensed)', description: 'Permits stocking animal medicines alongside human ones' },
    ],
  },
  veterinary: {
    key: 'veterinary',
    label: 'Veterinary Doctor',
    council: 'Veterinary Council of Nigeria',
    councilShort: 'VCN',
    licensePrefix: 'VCN',
    sections: [
      { key: 'general_veterinary', label: 'General Veterinary Practice', description: 'Standard animal medicines & vaccines' },
      { key: 'veterinary_controlled_drugs', label: 'Veterinary Controlled Drugs', description: 'Scheduled animal drugs requiring extra VCN authorization' },
    ],
  },
};

// A professional may add a category if they hold ANY of requiredSections ([] = no extra section needed).
const drugCategories = [
  { key: 'general', label: 'General / OTC', requiredSections: [] },
  { key: 'prescription', label: 'Prescription-only (POM)', requiredSections: [] },
  { key: 'controlled', label: 'Controlled Drug / Narcotic', requiredSections: ['controlled_drugs'] },
  { key: 'veterinary', label: 'Veterinary Drug', requiredSections: ['general_veterinary', 'veterinary_pharmacy'] },
  { key: 'veterinary_controlled', label: 'Veterinary Controlled Drug', requiredSections: ['veterinary_controlled_drugs'] },
];

const expiryBuckets = ['1 year', '6 months', '3 months', '1 month', '2 weeks', '1 week'];
const expiryBucketDays = { '1 year': 365, '6 months': 182, '3 months': 91, '1 month': 30, '2 weeks': 14, '1 week': 7 };

const NIGERIAN_STATES = [
  'Abia', 'Abuja (FCT)', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna',
  'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const allSectionKeys = Object.values(professionalTypes).flatMap((p) => p.sections.map((s) => s.key));

function sectionLabel(key) {
  for (const p of Object.values(professionalTypes)) {
    const m = p.sections.find((s) => s.key === key);
    if (m) return m.label;
  }
  return key;
}

const getCategory = (key) => drugCategories.find((c) => c.key === key);

module.exports = {
  professionalTypes, drugCategories, expiryBuckets, expiryBucketDays,
  NIGERIAN_STATES, allSectionKeys, sectionLabel, getCategory,
};
