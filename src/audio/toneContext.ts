// Importado antes de qualquer outro uso do Tone: faz o Tone adotar o AudioContext criado
// no gesto do usuário (ver context.ts), em vez de criar um novo depois de um await.
import * as Tone from "tone";
import { gestureAudioContext } from "./context";

const adopted = gestureAudioContext();
// O próprio Tone cria um contexto ao ser importado; `true` descarta esse contexto ocioso na troca.
if (adopted) Tone.setContext(adopted, true);
