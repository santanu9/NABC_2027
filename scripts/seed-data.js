// Seed data for NABC 2027. Times are PLACEHOLDERS — edit them in the UI.
const D = { setup: '2027-07-01', d1: '2027-07-02', d2: '2027-07-03', d3: '2027-07-04', teardown: '2027-07-05' };

const days = [
  { key: 'setup',    date: D.setup,    label: 'Setup Day',     short: 'Thu Jul 1', kind: 'setup' },
  { key: 'd1',       date: D.d1,       label: 'Event Day 1',   short: 'Fri Jul 2', kind: 'event' },
  { key: 'd2',       date: D.d2,       label: 'Event Day 2',   short: 'Sat Jul 3', kind: 'event' },
  { key: 'd3',       date: D.d3,       label: 'Event Day 3',   short: 'Sun Jul 4', kind: 'event' },
  { key: 'teardown', date: D.teardown, label: 'Tear Down Day', short: 'Mon Jul 5', kind: 'teardown' },
];

// Source: https://nabc2027.org/venue (Cow Palace, 2600 Geneva Ave, Daly City, CA 94014)
const venues = [
  { id: 'main-arena', name: 'Main Arena', notes: 'NABC 2027 main stage. Floor seating in front of stage; Box Seats along both sides; Elevated Floor, Dress Circle and Corners. Blocks nearest the stage are held for higher sponsorship levels.' },
  { id: 'north-hall', name: 'North Hall', notes: 'Adjacent to the Main Arena (north side).' },
  { id: 'south-hall', name: 'South Hall', notes: 'Adjacent to the Main Arena (south side).' },
  { id: 'expo-halls', name: 'Exhibition Halls (1–6)', notes: 'Six halls on the lower level behind the arena, used for the expo.' },
  { id: 'outdoor', name: 'Outdoor / Tent Area', notes: 'Tents, food and outdoor activities. Confirm exact footprint with Cow Palace.' },
  { id: 'parking', name: 'Parking & Entrances', notes: 'Parking lots, shuttle drop-off, registration entrances.' },
  { id: 'all', name: 'Whole Venue', notes: 'Applies to the entire Cow Palace campus.' },
];

const milestones = [
  { day: 'setup', time: '07:00', label: 'Venue setup starts — loading dock opens', venue: 'all', category: 'Venue' },
  { day: 'setup', time: '08:00', label: 'Tent crew starts', venue: 'outdoor', category: 'Tent' },
  { day: 'setup', time: '10:00', label: 'AV crew starts (stage, sound, lighting, LED)', venue: 'main-arena', category: 'AV' },
  { day: 'setup', time: '13:00', label: 'Expo booth build-out starts', venue: 'expo-halls', category: 'Expo' },
  { day: 'setup', time: '18:00', label: 'Walk-through & sound check', venue: 'main-arena', category: 'AV' },
  { day: 'd1',    time: '07:00', label: 'Venue doors open to staff & volunteers', venue: 'all', category: 'Venue' },
  { day: 'd1',    time: '08:00', label: 'Registration opens', venue: 'parking', category: 'Registration' },
  { day: 'd1',    time: '09:00', label: 'Opening program begins', venue: 'main-arena', category: 'Program' },
  { day: 'd2',    time: '08:00', label: 'Registration & expo open', venue: 'expo-halls', category: 'Registration' },
  { day: 'd3',    time: '08:00', label: 'Registration & expo open', venue: 'expo-halls', category: 'Registration' },
  { day: 'd3',    time: '21:00', label: 'Closing ceremony ends', venue: 'main-arena', category: 'Program' },
  { day: 'teardown', time: '07:00', label: 'Tear down starts', venue: 'all', category: 'Venue' },
  { day: 'teardown', time: '09:00', label: 'AV load-out starts', venue: 'main-arena', category: 'AV' },
  { day: 'teardown', time: '10:00', label: 'Tent removal starts', venue: 'outdoor', category: 'Tent' },
  { day: 'teardown', time: '17:00', label: 'Venue handed back to Cow Palace', venue: 'all', category: 'Venue' },
];

const T = (day, time, eta, venue, category, title, priority = 'medium') => ({
  title, day, startTime: time, eta: `${D[day]}T${eta}`, venue, category, priority,
  status: 'todo', description: '', leadName: '', leadEmail: '', leadPhone: '', team: [], notes: '',
  reminderHours: [24, 2],
});

const tasks = [
  T('setup','07:00','09:00','all','Venue','Venue setup kickoff & safety briefing','high'),
  T('setup','08:00','14:00','outdoor','Tent','Erect tents and secure anchors','high'),
  T('setup','10:00','17:00','main-arena','AV','Stage, truss and LED wall install','high'),
  T('setup','11:00','16:00','main-arena','AV','Sound system & lighting rig','high'),
  T('setup','13:00','20:00','expo-halls','Expo','Expo booth layout, carpet and signage','medium'),
  T('setup','14:00','18:00','parking','Registration','Registration desks, badges and signage setup','medium'),
  T('setup','15:00','19:00','all','Food','Kitchen / food court equipment delivery','medium'),
  T('setup','18:00','20:00','main-arena','AV','Full tech rehearsal and sound check','high'),
  T('d1','08:00','08:30','parking','Registration','Registration opens, volunteers in position','high'),
  T('d1','08:30','09:00','main-arena','AV','AV pre-show check','high'),
  T('d1','09:00','09:30','main-arena','Program','Opening ceremony','high'),
  T('d1','12:00','13:00','all','Food','Lunch service','medium'),
  T('d2','08:00','08:30','expo-halls','Expo','Expo hall opens, exhibitor check','medium'),
  T('d2','09:00','09:30','north-hall','Program','Breakout sessions start (North Hall)','medium'),
  T('d2','09:00','09:30','south-hall','Program','Breakout sessions start (South Hall)','medium'),
  T('d3','08:00','08:30','expo-halls','Expo','Expo hall opens','medium'),
  T('d3','18:00','21:00','main-arena','Program','Closing ceremony & cultural program','high'),
  T('teardown','07:00','08:00','all','Venue','Tear down kickoff & crew briefing','high'),
  T('teardown','09:00','14:00','main-arena','AV','AV load-out and truck packing','high'),
  T('teardown','10:00','15:00','outdoor','Tent','Tent removal','high'),
  T('teardown','12:00','16:00','expo-halls','Expo','Expo teardown and trash removal','medium'),
  T('teardown','16:00','17:00','all','Venue','Final walk-through and handover to Cow Palace','high'),
];

module.exports = { days, venues, milestones, tasks };
