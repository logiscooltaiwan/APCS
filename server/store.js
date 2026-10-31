"use strict";
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES = {
  questions: path.join(DATA_DIR, 'questions.json'),
  students: path.join(DATA_DIR, 'students.json'),
  results: path.join(DATA_DIR, 'results.json'),
  examPapers: path.join(DATA_DIR, 'examPapers.json'),
};
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_CONFIG = { CSA: { mcqMin: 90, frqMin: 90 }, CSP: { mcqMin: 90 } };

function readJson(file, fallback){
  try{ return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch(e){ return fallback; }
}
function writeJsonAtomic(file, data){
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

const state = {
  questions: readJson(FILES.questions, []),
  students: readJson(FILES.students, []),
  results: readJson(FILES.results, []),
  examPapers: readJson(FILES.examPapers, []),
  config: readJson(CONFIG_FILE, DEFAULT_CONFIG),
};

function persist(name){
  if(name==='config') writeJsonAtomic(CONFIG_FILE, state.config);
  else writeJsonAtomic(FILES[name], state[name]);
}

function list(name){ return state[name]; }
function find(name, id){ return state[name].find(d => d.id===id) || null; }
function upsert(name, id, data){
  const arr = state[name];
  const i = arr.findIndex(d => d.id===id);
  const doc = { ...data, id };
  if(i>=0) arr[i]=doc; else arr.push(doc);
  persist(name);
  return doc;
}
function patch(name, id, partial){
  const arr = state[name];
  const i = arr.findIndex(d => d.id===id);
  if(i<0) return null;
  arr[i] = { ...arr[i], ...partial, id };
  persist(name);
  return arr[i];
}
function remove(name, id){
  const arr = state[name];
  const i = arr.findIndex(d => d.id===id);
  if(i<0) return false;
  arr.splice(i,1);
  persist(name);
  return true;
}
function getConfig(){ return state.config; }
function setConfig(cfg){
  state.config = {
    CSA: { ...DEFAULT_CONFIG.CSA, ...(cfg.CSA||{}) },
    CSP: { ...DEFAULT_CONFIG.CSP, ...(cfg.CSP||{}) },
  };
  persist('config');
  return state.config;
}

module.exports = { list, find, upsert, patch, remove, getConfig, setConfig };
