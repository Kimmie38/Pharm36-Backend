// Nigeria (and most of the world) uses INN/BAN drug names; the FDA label database uses US names.
// Without this, "Paracetamol" returns nothing because FDA labels call it "acetaminophen".
const SYNONYMS = {
  paracetamol: 'acetaminophen',
  salbutamol: 'albuterol',
  adrenaline: 'epinephrine',
  noradrenaline: 'norepinephrine',
  frusemide: 'furosemide',
  rifampicin: 'rifampin',
  lignocaine: 'lidocaine',
  glibenclamide: 'glyburide',
  amoxycillin: 'amoxicillin',
  chlorphenamine: 'chlorpheniramine',
  pethidine: 'meperidine',
  thyroxine: 'levothyroxine',
  hyoscine: 'scopolamine',
  sulphadoxine: 'sulfadoxine',
  sulphamethoxazole: 'sulfamethoxazole',
  'vitamin c': 'ascorbic acid',
  'vitamin b12': 'cyanocobalamin',
  'vitamin b1': 'thiamine',
  'vitamin b6': 'pyridoxine',
  'vitamin k': 'phytonadione',
  'vitamin e': 'tocopherol',
  aspirin: 'aspirin',
};

// Brand-style combination shorthands
const COMBOS = {
  'co-trimoxazole': ['sulfamethoxazole', 'trimethoprim'],
  cotrimoxazole: ['sulfamethoxazole', 'trimethoprim'],
  'co-amoxiclav': ['amoxicillin', 'clavulanate'],
  coamoxiclav: ['amoxicillin', 'clavulanate'],
};

module.exports = { SYNONYMS, COMBOS };
