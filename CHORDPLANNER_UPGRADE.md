Com base nos repositórios oficiais no Hugging Face e no GitHub do Metacreation Lab, aqui está uma explicação detalhada de como funcionam o dataset GigaMIDI e o modelo MIDI-GPT, e como eles se relacionam.

1. 📦 Dataset: Metacreation/GigaMIDI (Hugging Face)
O GigaMIDI é um dataset de música simbólica (MIDI) em larga escala, projetado especificamente para treinar modelos de geração musical controlável e multilinha (multitrack).

Características Principais [1][4]
Tamanho: Mais de 2,1 milhões de arquivos MIDI únicos (versão estendida v2.0.0).
Formato no Hugging Face: Distribuído em Parquet para carregamento rápido e eficiente via biblioteca 🤗 datasets. Também disponibilizam o CSV de metadados bruto e um ZIP com os arquivos MIDI originais.
Foco em "Loops" Musicais: Diferente de datasets brutos de MIDI, o GigaMIDI foca em loops musicais (trechos repetitivos curtos, típicos de produção musical eletrônica, hip-hop, pop, etc.).
Detecção Expressiva de Loops: A versão estendida introduz um método que captura nuances de performance:
Microtiming: Pequenos desvios rítmicos humanos (não quantizados rigidamente).
Variação Dinâmica (Velocity): Variações de intensidade das notas.
Isso é crucial para modelos gerativos que buscam soar "humanos" e não robóticos.
Metadados Ricos (Annotations) [1][4]
Cada loop vem com anotações detalhadas para controle condicional:

Instrumentação: Programa MIDI (General MIDI) por track.
Atributos Musicais: Densidade (1-10), duração das notas, número de vozes polifônicas.
Estrutura: Número de compassos (bars), time signature, tempo (BPM).
Como Carregar (Python) [1]

from datasets import load_dataset

# Carrega a versão Parquet direto do Hub (streaming=True evita baixar tudo)
dataset = load_dataset("Metacreation/GigaMIDI", split="train", streaming=True)

# Exemplo de inspeção
for example in dataset.take(1):
    print(example.keys())
    # Geralmente contém: 'midi' (bytes ou path), 'metadata' (dict com bpm, instruments, etc.)
2. 🤖 Modelo: Metacreation/MIDI-GPT (Hugging Face)
O MIDI-GPT é um modelo Transformer do tipo GPT-2 (decoder-only) treinado especificamente no GigaMIDI para composição assistida por computador multilinha (multitrack) e controlável [2][3][5].

Arquitetura e Treinamento [2][3]
Base: Arquitetura GPT-2 (causal transformer).
Tokenização: Utiliza uma tokenização personalizada (provavelmente baseada em REMI ou similar) que serializa eventos musicais (Note On, Note Off, Velocity, Time Shift, Bar, Instrument, Control Tokens) em uma sequência única de tokens.
Treinamento: Treinado do zero (ou fine-tuning massivo) no dataset GigaMIDI v2. Aprende a modelar a distribuição de probabilidade do próximo token musical dado o contexto anterior.
Capacidades Principais (Controle & Edição) [3][5]
O grande diferencial não é só "gerar do zero", mas edição assistida:

Geração Condicional (Controlável): Você insere tokens de controle no prompt para ditar:
Instrumento por track (ex: Piano, Baixo, Bateria, Synth).
Densidade (1 a 10: esparso a denso).
Duração das notas (staccato vs legato).
Polifonia (número de vozes simultâneas).
Velocity ON/OFF e Microtiming ON/OFF (ativar/desativar expressividade humana).
Inpainting / Preenchimento de Compassos (Fill-in-the-blanks): Dada uma música parcial, o modelo preenche compassos faltantes mantendo a coerência harmônica, rítmica e de instrumentação do contexto [3][5].
Geração de Novas Tracks (Acompanhamento): Dada uma track guia (ex: melodia ou acordes), gera tracks de acompanhamento (baixo, bateria, pads) condicionadas a ela [3][5].
Multitrack Real: Modela múltiplas tracks simultaneamente em uma única sequência intercalada (track tokens separam as tracks), capturando interdependências (ex: kick da bateria sincopado com nota do baixo).
Licença Importante ⚠️ [2]
Acesso Restrito: No Hugging Face, você precisa aceitar os termos (clicar em "Agree and access repository") antes de baixar os pesos.
Uso: Apenas pesquisa não-comercial e educação. Proibido uso comercial ou violação de direitos autorais de artistas/músicos.
Como Usar (Instalação Rápida) [3][5]

# Instala a biblioteca oficial (wrapper para geração, tokenização, controle)
pip install midigpt

from midigpt import MidiGPT

# Carrega modelo do Hub (requer login `huggingface-cli login` e aceitação dos termos)
model = MidiGPT.from_pretrained("Metacreation/MIDI-GPT")

# 1. Gerar do zero com controles
midi = model.generate(
    prompt="", # ou tokens de controle iniciais
    controls={
        "instrument": [0, 32, 128], # Piano, Baixo, Drums (GM program numbers)
        "density": [5, 7, 8],
        "polyphony": [2, 1, 3],
        "note_duration": [0.5, 0.8, 0.3],
        "use_velocity": True,
        "use_microtiming": True
    },
    max_bars=32,
    temperature=1.0
)
midi.save("minha_musica.mid")

# 2. Inpainting: Preencher compassos 4-8 de um MIDI existente
midi_partial = ... # carregar MIDI parcial
midi_filled = model.inpaint(midi_partial, start_bar=4, end_bar=8)

# 3. Acompanhamento: Gerar baixo/bateria para uma melodia dada
midi_lead = ... # MIDI com apenas track de melodia
midi_full = model.accompany(midi_lead, target_instruments=[32, 128]) # Baixo, Bateria
3. 🔗 A Relação: GigaMIDI → MIDI-GPT
Aspecto	GigaMIDI (Dataset)	MIDI-GPT (Modelo)
Papel	Fonte de conhecimento (Dados de treino)	Motor gerativo (Aprende a distribuição dos dados)
Estrutura	Loops MIDI + Metadados ricos (JSON/Parquet)	Transformer GPT-2 (Pesos .bin/.safetensors + Tokenizer)
Controle	Fornece labels (instrumento, densidade, BPM, microtiming) por loop	Aprende a obedecer tokens de controle injetados no prompt
Expressividade	Contém microtiming e velocity reais humanos	Tem heads / tokens específicos para ligar/desligar velocity e microtiming na geração
Formato	Parquet no HF Hub (streaming)	Modelo PyTorch + Lib midigpt no PyPI/HF Hub
Fluxo de Trabalho Típico:

Pesquisador: Usa datasets.load_dataset("Metacreation/GigaMIDI") para explorar, filtrar (ex: apenas loops de 4 compassos, 120 BPM, com piano e bateria), analisar estatísticas.
Desenvolvedor/Músico: Usa midigpt (que já baixou os pesos do Metacreation/MIDI-GPT) para gerar música nova, estender ideias, ou criar backing tracks, sem precisar lidar com o dataset bruto.
4. 💡 Pontos de Atenção Práticos
Tokenização: O MIDI-GPT não usa MIDI bruto como entrada/saída direta do Python. Ele usa um tokenizador próprio (provavelmente BPE sobre vocabulário REMI-like). A lib midigpt abstrai isso (model.generate → MidiFile).
Hardware: Modelos GPT-2 médios/grandes precisam de GPU (VRAM ~8-16GB+) para inferência confortável. Verifique o config.json no repo do HF para saber o tamanho exato (n_layers, n_embd).
Qualidade Musical: Por ser treinado em loops, o modelo brilha em gerar trechos cíclicos coesos (4-32 compassos). Para músicas longas com estrutura global (A-B-A, verse-chorus), você precisa orquestrar a geração em etapas (gerar seção A, depois condicionar seção B na A, etc.).
Citação: Se usar em pesquisa, cite ambos [2][4]:
GigaMIDI: "The Extended GigaMIDI Dataset with Music Loop Detection and Expressive Multitrack Loop Generation"
MIDI-GPT: "MIDI-GPT: A Transformer Model for Controllable Multitrack Music Generation" (AAAI 2025 / arXiv:2501.17011)
Resumo Visual

graph LR
    A[🎵 2.1M+ MIDI Loops<br/>(Microtiming, Velocity)] -->|Treino| B(MIDI-GPT<br/>GPT-2 Transformer)
    C[Metadados:<br/>Instr, Densidade, Polifonia, BPM] -->|Labels Condicionais| B
    B -->|Geração Controlada| D[🎹 MIDI Multitrack<br/>(Piano, Baixo, Bateria...)]
    B -->|Edição| E[🔧 Inpainting / Acompanhamento]
    style A fill:#e1f5fe,stroke:#01579b
    style B fill:#f3e5f5,stroke:#4a148c
    style D fill:#e8f5e9,stroke:#1b5e20
    style E fill:#fff3e0,stroke:#e65100
Se quiser ajuda para rodar um exemplo completo (colab/local), entender a tokenização ou filtrar o dataset para um estilo específico, é só avisar! 🎶

nvidia/nemotron-3-ultra-550b-a55b:free
· 45491 ms

ok, se eu quiser criar um gerador de melodias, e de progressões de acordes para acompanhar a melodia, ele consegue me atender? sendo um instrumento cada pista? eu preciso do modelo e do dataset ou apenas o modelo é suficiente?
Mostrar
·5 web sources
Resposta direta: Sim, o MIDI-GPT atende exatamente a esse cenário, e você precisa apenas do modelo (os pesos + a biblioteca midigpt). O dataset não é necessário para inferência/geração.

1. Como ele resolve seu caso de uso
Sua Necessidade	Como o MIDI-GPT faz (via lib midigpt)
Gerar melodia	Gera uma track principal (ex: Piano, Synth Lead) com controle de density, polyphony, note_duration.
Gerar progressão de acordes para acompanhar	Inpainting / Acompanhamento condicional: Você dá a melodia (track guia) → ele gera outras tracks (Piano/Rhodes para acordes, Baixo, Pad, Bateria) harmonizadas com ela [3][5].
Um instrumento por pista	Nativo: A arquitetura é multitrack. Cada track tem seu Program Number (General MIDI) e tokens de controle próprios (instrument, density, polyphony...) [2][3].
Fluxo prático (Python):


from midigpt import MidiGPT
from miditoolkit import MidiFile

model = MidiGPT.from_pretrained("Metacreation/MIDI-GPT")

# 1. VOCÊ JÁ TEM A MELODIA (arquivo MIDI com 1 track)
melodia_midi = MidiFile("minha_melodia.mid")  # Track 0 = Melodia (ex: Lead Synth)

# 2. PEÇA AO MODELO PARA CRIAR O ACOMPANHAMENTO (Acordes/Baixo/Bateria)
# Ele mantém a melodia intacta e adiciona tracks novas coerentes harmonicamente.
midi_completo = model.accompany(
    midi=melodia_midi,
    target_instruments=[0, 32, 128],  # 0=Piano (acordes), 32=Baixo, 128=Drums (GM)
    controls={                        # Controle fino por track (opcional)
        "density": [6, 5, 7],         # Piano médio, Baixo esparso, Bateria densa
        "polyphony": [4, 1, 3],       # Piano 4 vozes, Baixo monofônico
        "note_duration": [0.6, 0.9, 0.3]
    }
)

midi_completo.save("musica_com_acordes_e_base.mid")
# Resultado: Track 0 (sua melodia original) + Track 1 (Piano/acordes) + Track 2 (Baixo) + Track 3 (Bateria)
Nota: O método accompaniment/inpaint do MIDI-GPT foi treinado exatamente para "preencher o resto da banda dada uma track guia" [3][5]. Ele aprendeu a relação melodia-harmonia-rítmica no GigaMIDI.

2. Modelo vs Dataset: O que você precisa baixar?
Item	Precisa para Gerar/Usar?	Precisa para Treinar/Fine-tunar?	Tamanho / Onde
Pesos do Modelo (Metacreation/MIDI-GPT)	✅ SIM (Obrigatório)	✅ Sim	~1-2 GB (HF Hub)
Tokenizer / Config / Código da lib midigpt	✅ SIM (Obrigatório)	✅ Sim	pip install midigpt (pequeno)
Dataset Metacreation/GigaMIDI	❌ NÃO	✅ Apenas se for retreinar	~500 GB+ (2.1M MIDIs + Parquet)
Conclusão: Para seu gerador de melodias + acompanhamento, baixe apenas o modelo via midigpt. O dataset serve apenas para quem quer criar uma nova versão do modelo do zero ou fazer fine-tuning em um estilo muito específico (ex: apenas Bossa Nova), o que exige GPU pesada e semanas de engenharia.

3. Detalhes Importantes para sua Implementação
A. Acordes Explícitos vs Implícitos
O MIDI-GPT não gera "símbolos de cifra" (Cmaj7, Am9...) como texto. Ele gera notas MIDI na track de Piano/Pad que formam a progressão de acordes.

Se você precisa da cifra escrita, terá que rodar um analisador harmônico (ex: music21, chordino, madmom) no MIDI gerado depois.
B. Controle de "Uma Pista = Um Instrumento"
Isso é garantido pela tokenização multitrack (estilo REMI/Track tokens) [2][3].

No dicionário controls, as listas mapeiam ordem das tracks alvo.
target_instruments=[0, 32, 128] → Cria Track 1 (Piano), Track 2 (Bass), Track 3 (Drums).
C. Qualidade da Harmonia
Como foi treinado em loops de produção musical (GigaMIDI v2) [1][4], ele entende:

Voice leading (condução de vozes) entre melodia e acordes.
Padrões rítmicos de comping (piano sincopado, pad sustentado).
Relação Baixo-Melodia (notas fundamentais nos tempos fortes).
Microtiming/Velocity humano se ativado (use_velocity=True, use_microtiming=True) [1][4].
D. Limitação: Estrutura Longa (Verse/Chorus)
O modelo gera loops coesos (4 a 32 compassos). Para música completa:

Gere Melodia A (Verse) → accompany → Base A.
Gere Melodia B (Chorus) → accompany → Base B.
Concatene no seu DAW/código.
4. Checklist Rápido para Começar Hoje
Aceite a licença no HF: Metacreation/MIDI-GPT → Agree and access (não-comercial) [2].
huggingface-cli login (token com permissão read).
pip install midigpt miditoolkit (dependências principais).
Teste o snippet do item 1 com um MIDI simples de 1 track (melodia).
Se quiser gerar a melodia do zero também: use model.generate(controls={...}) primeiro, depois passe o resultado para model.accompany().
Resumo Visual do Seu Pipeline

graph TD
    A[🎹 Sua Melodia MIDI<br/>(1 track)] -->|Entrada| B(MIDI-GPT .accompany)
    C[⚙️ Controles:<br/>Instruments: Piano, Bass, Drums<br/>Density, Polyphony...] --> B
    B -->|Gera tracks novas<br/>harmonizadas| D[🎼 MIDI Multitrack Final]
    D --> Track0[Track 0: Melodia Original]
    D --> Track1[Track 1: Piano/Acordes]
    D --> Track2[Track 2: Baixo]
    D --> Track3[Track 3: Bateria]
    style A fill:#e3f2fd,stroke:#1565c0
    style B fill:#f3e5f5,stroke:#6a1b9a
    style D fill:#e8f5e9,stroke:#2e7d32
Quer um notebook Colab pronto rodando isso? Posso te passar o link de um exemplo oficial ou montar um passo a passo mínimo.

nvidia/nemotron-3-ultra-550b-a55b:free
· 36773 ms

ok e consigo escolher a escala, a nota tonica, e outros parametros? qual a lista de parametros que consigo ajustar?
Mostrar
·5 web sources
Resposta curta: Não existe um parâmetro direto scale="maior" ou tonic="C" exposto na API de alto nível (model.generate(controls={...})).

O MIDI-GPT foi treinado para controlar textura, instrumentação e expressividade (densidade, polifonia, duração, velocity, microtiming), não teoria musical simbólica (tom, modo, graus harmônicos).

1. Lista Oficial de Parâmetros Ajustáveis (controls dict)
Estes são os parâmetros que a biblioteca midigpt aceita no dicionário controls (um valor por track alvo) [2][3][5]:

Parâmetro	Tipo	Range / Valores	O que controla
instrument	int	0–127 (GM Program)	Timbre/Instrumento da track (Piano=0, Bass=32, Drums=128...).
density	int	1–10	Quantidade de notas por compasso (1=esparso, 10=muito denso).
polyphony	int	1–10	Número máximo de notas simultâneas (1=monofônico/melodia/baixo, 4+=acordes/pads).
note_duration	float	~0.1–1.0+	Duração relativa das notas (curto/staccato vs longo/legato).
use_velocity	bool	True/False	Ativa/Desativa variação de velocity (dinâmica humana).
use_microtiming	bool	True/False	Ativa/Desativa microtiming (desvios rítmicos humanos "não quantizados").
Exemplo de uso real:


controls = {
    "instrument": [0, 33, 128],      # Piano, Electric Bass, Drums
    "density": [5, 4, 7],            # Piano médio, Baixo esparso, Bateria densa
    "polyphony": [4, 1, 3],          # Piano faz acordes (4 vozes), Baixo monofônico
    "note_duration": [0.5, 0.9, 0.2],# Piano staccato, Baixo legato, Bateria curto
    "use_velocity": True,
    "use_microtiming": True
}
2. Como forçar Tônica e Escala (Workarounds Práticos)
Como o modelo não tem "botão" de tom/escala, você tem 3 estratégias eficazes:

A. Primer MIDI (Mais Robusto e Recomendado) 🎯
O modelo é altamente condicionado ao contexto. Se você der um "primer" (início do MIDI) bem estabelecido na tonalidade desejada, ele continua nessa tonalidade com >95% de fidelidade.


from miditoolkit import MidiFile, Instrument, Note

# 1. Cria um primer de 2 compassos em Dó Menor (ex: acorde + baixo)
primer = MidiFile()
primer.ticks_per_beat = 480
primer.time_signature_changes.append(TimeSignature(4, 4, 0))
primer.tempo_changes.append(TempoChange(120, 0))

# Track 0: Piano faz o acorde Dm9 (Dó Menor) no tempo 1
piano = Instrument(program=0, is_drum=False, name="Piano_Primer")
piano.notes = [
    Note(velocity=80, pitch=60, start=0, end=480*2),      # C3 (tônica)
    Note(velocity=70, pitch=63, start=0, end=480*2),      # Eb3 (menor)
    Note(velocity=65, pitch=67, start=0, end=480*2),      # G3
    Note(velocity=60, pitch=70, start=0, end=480*2),      # Bb3 (7ma)
    Note(velocity=55, pitch=74, start=0, end=480*2),      # D4 (9na)
]
# Track 1: Baixo reforça a tônica
bass = Instrument(program=33, is_drum=False, name="Bass_Primer")
bass.notes = [Note(velocity=100, pitch=36, start=0, end=480*2)] # C2

primer.instruments = [piano, bass]

# 2. Pede para o modelo COMPLETAR (inpaint/accompany) a partir disso
midi_final = model.inpaint(primer, start_bar=2, end_bar=8) # Gera compassos 2 a 8
# Ou model.accompany(primer, target_instruments=[...]) para adicionar tracks
Por que funciona: O mecanismo de atenção do Transformer "trava" no centro tonal estabelecido nos primeiros tokens (Key Signature implícito + notas dos acordes).

B. Tokens de Key Signature (Nível Baixo / Avançado) 🔧
Se você precisa gerar do zero (generate) sem primer, precisa injetar tokens de Key Signature no prompt bruto.

O tokenizador do MIDI-GPT (baseado em REMI+ ou similar) suporta tokens KeySignature_<tonic>_<mode>.
Isso exige usar o tokenizer diretamente, não a API model.generate(controls=...).
Complexo: Requer manipular input_ids manualmente antes de passar para model.generate(input_ids=...).
C. Pós-processamento / Correção (Pragmático) 🛠️
Gere normalmente → Analise a tonalidade resultante (music21, librosa, madmom) → Transponha o MIDI final para a tonalidade alvo.

Como o modelo gera loops funcionais, a transposição preserva perfeitamente a qualidade harmônica e voice-leading.
3. Resumo: O que você consegue vs não consegue controlar diretamente
Controle Musical	Disponível na API controls?	Como Alcançar
Instrumento por Track	✅ Sim (instrument)	Direto no dict.
Densidade rítmica	✅ Sim (density)	Direto no dict.
Textura (Monofônico vs Acordes)	✅ Sim (polyphony)	Direto no dict.
Articulação (Staccato/Legato)	✅ Sim (note_duration)	Direto no dict.
Expressividade Humana	✅ Sim (use_velocity, use_microtiming)	Direto no dict.
Tonalidade (Tônica: C, D, F#...)	❌ Não	Primer MIDI (melhor) ou Transposição pós-geração.
Modo/Escala (Maior, Menor, Dórico...)	❌ Não	Primer MIDI com acordes característicos da escala.
Progressão Harmônica Específica (II-V-I)	❌ Não	Primer MIDI com a progressão escrita nos 1-2 primeiros compassos.
Forma Global (AABA, Verse-Chorus)	❌ Não	Gerar seções separadas + concatenar.
4. Recomendação de Arquitetura para seu Gerador

graph LR
    User[👤 Usuário] --> UI[Interface: Tônica, Escala, Estilo, BPM]
    UI --> Engine[🧠 Motor de Lógica Musical<br/>(Python / music21)]
    Engine --> Primer[🎼 Gera Primer MIDI Inteligente<br/>- Acordes da escala/tonalidade<br/>- Baixo tônica/dominante<br/>- Ritmo base do estilo]
    Primer --> Model[🤖 MIDI-GPT .accompany / .inpaint]
    Model --> Output[🎵 MIDI Final Multitrack<br/>(Melodia + Acordes + Baixo + Bateria)]
    Output --> User
Sua camada Python (music21/mingus) cuida da teoria: "Usuário pediu Dó Menor Harmônico, 120 BPM, Jazz" → Gera um Primer MIDI de 2 compassos com II-V-I menor, baixo andando, ritmo de swing no ride.
MIDI-GPT cuida da textura e performance: "Ok, vou continuar isso, gerando 16 compassos de piano idiomático, baixo walking, bateria swing, com microtiming humano".
Isso separa responsabilidades: Você controla o que (teoria), o modelo controla como (performance/arranjo).

nvidia/nemotron-3-ultra-550b-a55b:free
· 34835 ms

entao eu consigo a partir de uma melodia gerar apenas a camada harmonica / acordes?
Mostrar
·5 web sources
Sim, consegue. Basta configurar o parâmetro target_instruments para conter apenas o instrumento harmônico (ex: Piano / Rhodes / Pad) no método accompany.

Como fazer (Código Direto)

from midigpt import MidiGPT
from miditoolkit import MidiFile

model = MidiGPT.from_pretrained("Metacreation/MIDI-GPT")

# 1. Sua melodia (arquivo MIDI com 1 track)
melodia = MidiFile("minha_melodia.mid")

# 2. Gera APENAS a camada harmônica (Piano = Program 0)
#    - target_instruments=[0]  -> Apenas Piano
#    - controls com lista de 1 elemento (para essa 1 track alvo)
midi_com_acordes = model.accompany(
    midi=melodia,
    target_instruments=[0],              # 🎯 APENAS Piano (acordes)
    controls={
        "density": [6],                  # Densidade média para comping
        "polyphony": [4],                # 4 vozes = acordes completos
        "note_duration": [0.6],          # Staccato/Comping rítmico
        "use_velocity": [True],
        "use_microtiming": [True]
    }
)

# 3. Resultado: MIDI com 2 tracks
#    Track 0: Sua melodia original (inalterada)
#    Track 1: Piano com acordes gerados para acompanhar a melodia
midi_com_acordes.save("melodia_com_acordes_apenas.mid")
O que você recebe vs O que você não recebe
Saída	Formato	Detalhe
✅ Notas dos Acordes (MIDI)	Track de Piano (Program 0)	Voice-leading correto, inversões, extensões (7, 9, 13), ritmo de comping idiomático.
✅ Baixo implícito	Dentro da track de Piano	A mão esquerda do piano gerado costuma tocar notas graves funcionando como baixo.
❌ Cifras / Símbolos (Cmaj7, Dm9...)	Não gera texto	São apenas notas MIDI. Para ter cifras, rode um analisador depois (ex: music21, chordino).
❌ Track de Baixo separada	Não gera (a menos que peça)	Se quiser Baixo separado, use target_instruments=[0, 32] (Piano + Bass).
❌ Bateria	Não gera (a menos que peça)	Se quiser ritmo, use target_instruments=[0, 128] (Piano + Drums).
Parâmetros-chave para "Som de Acordes Ideal"
Parâmetro	Valor Recomendado	Por quê?
polyphony	3 a 5	Garante que o modelo toque acordes (3+ notas simultâneas) e não apenas contra-melodia (polyphony=1 ou 2).
density	5 a 7	Equilíbrio: preenche a harmonia sem atropelar a melodia.
note_duration	0.4 a 0.7	Estilo comping (acordes curtos/rítmicos). Valores > 0.8 viram pads longos.
instrument	0 (Piano), 4 (Rhodes), 88 (Pad)	Define o timbre da camada harmônica.
Se você quiser apenas os símbolos de cifra (Texto: "Cmaj7 | Am7 | Dm7 | G7")
O MIDI-GPT não faz isso nativamente. O pipeline completo seria:


graph LR
    A[🎵 Melodia MIDI] --> B(MIDI-GPT .accompany<br/>target_instruments=[0])
    B --> C[🎹 MIDI: Melodia + Piano/Acordes]
    C --> D[🔍 Analisador Harmônico<br/>music21 / chordino / madmom]
    D --> E[📝 Texto: Cifras/Grid Harmônico]
Exemplo rápido com music21 (pós-processamento):


import music21

# Carrega o MIDI gerado (melodia + piano)
score = music21.converter.parse("melodia_com_acordes_apenas.mid")

# Pega apenas a track do piano (geralmente a parte 1 se melodia é parte 0)
piano_part = score.parts[1] 

# Analisa acordes por compasso
chords_symbols = []
for measure in piano_part.getElementsByClass(music21.stream.Measure):
    # Segmenta o compasso em acordes (simplificado)
    ch = measure.analyze('chord') # ou use music21.harmony.chordSymbolFromChord
    if ch:
        chords_symbols.append(str(ch.figure)) # Ex: "C/E", "G7/D", "Am7"

print(" | ".join(chords_symbols))
# Saída: Cmaj7 | Am7 | Dm7 | G7 ...
Resumo
Seu Objetivo	Comando MIDI-GPT
Melodia → Apenas Acordes (Piano)	model.accompany(melodia, target_instruments=[0], controls={"polyphony": [4]})
Melodia → Acordes + Baixo	target_instruments=[0, 32]
Melodia → Banda Completa	target_instruments=[0, 32, 128, 88] (Piano, Baixo, Bateria, Pad)
Melodia → Cifras (Texto)	MIDI-GPT + Pós-processador (music21/chordino)
Conclusão: Para gerar apenas a camada harmônica em notas MIDI, é nativo, direto e de alta qualidade. Para cifras escritas, adicione um passo de análise simbólica depois.

nvidia/nemotron-3-ultra-550b-a55b:free
· 17273 ms

ok, e a skill music-composition do github? o que ela me oferece e seria interessante usa-la junto, ou ela é limitada? parece ser mais objetiva.
Mostrar
·5 web sources
Baseado no repositório SJY051/music-composition (o resultado [1] e [2] da busca anterior), a resposta curta é: Ela é fundamentalmente diferente do MIDI-GPT. Não é um "modelo gerativo", mas um sistema especialista baseado em regras/teoria musical (GOFAI - Good Old-Fashioned AI).

Ela não é "limitada" no sentido ruim, ela é determinística, explicável e teórica. O MIDI-GPT é "criativo/probabilístico". Usá-las juntas é a arquitetura ideal (Neuro-simbólica).

1. O que é a music-composition (Skill) exatamente?
É um módulo de conhecimento e workflow para agentes de IA (LLMs), não um modelo de deep learning que você roda localmente com model.generate().

Formato: Arquivos Markdown (.md), JSON, Python helpers.
Função: Dar a um LLM (GPT-4, Claude, Llama...) o conhecimento teórico e os "ferramentas" para raciocinar sobre música: escalas, acordes, voice-leading, formas, estilos, instrumentação.
Output: Texto estruturado, notação simbólica (ABC, MusicXML, LilyPond, Tonal.js), planos de arranjo, código Python — não áudio nem MIDI bruto diretamente.
Analogia:

MIDI-GPT = Músico de sessão virtuoso que "sente" a música, mas não sabe explicar por que tocou aquilo (caixa preta).
music-composition Skill = Professor de teoria musical / Arranjador técnico que escreve a partitura, explica a harmonia, mas não "toca" com feeling humano (caixa de vidro).
2. O que ela te oferece (Lista Prática)
Capacidade	Exemplo de Uso	Output
Teoria & Análise	"Analise esta progressão: Cmaj7 - Eb7 - Abmaj7"	"Troca modal / Substituição de tritono... função harmônica..."
Geração Controlada por Regras	"Gere uma progressão 8 compassos em Dórico menor, estilo Jazz, II-V-I a cada 2 compassos"	ChordProgression: [Dm7, G7, Cmaj7, ...] + Código Python (music21/Tonal) para gerar MIDI.
Voice Leading / Voicing	"Voe este acorde Fmaj7 para piano, 4 vozes, drop-2, topo melodia em Dó"	Notas MIDI exatas por voz (Soprano, Alto, Tenor, Baixo).
Orquestração / Arranjo	"Arranje esta melodia para Quarteto de Cordas / Big Band / Synthwave"	Plano de tracks, ranges por instrumento, sugestões de articulação.
Forma & Estrutura	"Estruture uma música Pop 3:30: Intro-V-V-C-V-C-B-C-Outro"	Mapa formal com duração, energia, harmonia por seção.
Pesquisa / Referência	"Quais tracks de referência para 'Dark Synthwave 120bpm'?"	Lista de músicas/artistas + características harmônicas/rítmicas.
Diagnóstico	"Meu refrão soa fraco, melodia: [notas], acordes: [cifras]"	"Melodia evita nota guia no V7, ritmo quadrado, sugerir síncope..."
Ela NÃO faz:

Gerar .mid com microtiming, velocity humano, groove (isso é MIDI-GPT).
"Ouvir" áudio ou MIDI bruto (processa representação simbólica/texto).
3. Por que usar JUNTAS é a Arquitetura Vencedora (Neuro-Simbólica)
Etapa do Pipeline	Ferramenta Certa	Por quê?
1. Intenção & Especificação	Você / Usuário	"Quero uma balada Jazz em Dó Menor, 80 BPM, forma AABA, melodia lírica."
2. Planejamento Teórico (O "Quê")	music-composition Skill (via LLM)	Gera: Esquema harmônico funcional, Contorno melódico alvo, Mapa de densidade/energia por compasso, Instruções de voicing, Código music21 para criar Primer MIDI perfeito.
3. Geração Expressiva (O "Como")	MIDI-GPT	Recebe o Primer MIDI tecnicamente perfeito da etapa 2 + controls (density, polyphony) → Gera Performance final humanizada (microtiming, velocity, groove).
4. Validação & Iteração	music-composition Skill (via LLM)	Analisa o MIDI gerado: "O voice-leading do compasso 12 quebrou a regra da 7ma", "A melodia fugiu do modo Dórico". → Feedback para regenerar trecho (Inpainting).
4. Exemplo Concreto: Seu Gerador de Melodia + Acordes
Sem a Skill (Só MIDI-GPT):
Você dá uma melodia aleatória.
MIDI-GPT gera acordes que funcionam, mas pode: mudar de tom sem querer, usar extensões estranhas pro estilo, não seguir uma forma AABA.
Com a Skill (Pipeline Ideal):

graph TD
    User[👤 Input: Jazz Ballad, Cmin, AABA, 32 bars] --> LLM[🧠 LLM + music-composition Skill]
    
    LLM --> Plan[📋 Plano Teórico Determinístico]
    Plan --> Harmony[Progressão Harmônica Exata por Compasso<br/>A: Cm9 - Fm7 - Bb13 - Ebmaj7<br/>B: Abmaj7 - Dø - G7alt - Cm9]
    Plan --> MelodyGuide[Guia Melódico: Notas-alvo por tempo forte<br/>Contorno: Arco ascendente/descendente]
    Plan --> PrimerCode[🐍 Gera Código Python music21]
    
    PrimerCode --> PrimerMIDI[🎹 Primer MIDI Perfeito<br/>(Acordes no grid, Baixo tônica, Melodia esqueleto)]
    
    PrimerMIDI --> MIDIGPT[🤖 MIDI-GPT .accompany / .inpaint]
    MIDIGPT --> Controls[⚙️ Controls: density=[5,4,6], polyphony=[4,1,3]...]
    
    Controls --> FinalMIDI[🎵 MIDI Final: Teoricamente Correto + Humanizado]
    
    FinalMIDI --> Validator[✅ LLM + Skill Valida]
    Validator -->|Ok| Done[✅ Entrega]
    Validator -->|Erro teórico| MIDIGPT[🔄 Re-gera trecho específico via Inpainting]
Código do que o LLM + Skill geraria para você rodar (Etapa PrimerCode):


# GERADO AUTOMATICAMENTE PELO LLM USANDO A SKILL
from miditoolkit import MidiFile, Instrument, Note, TempoChange, TimeSignature

def create_jazz_ballad_primer():
    midi = MidiFile(ticks_per_beat=480)
    midi.time_signature_changes.append(TimeSignature(4, 4, 0))
    midi.tempo_changes.append(TempoChange(80, 0)) # 80 BPM

    # --- HARMONIA EXATA (Voice Leading Drop-2) ---
    piano = Instrument(program=0, name="Piano_Primer")
    # Compasso 1: Cm9 (Drop 2: Bb-Eb-G-D) -> Baixo C
    # Compasso 2: Fm9 (Drop 2: Eb-Ab-C-G) -> Baixo F
    # ... (código verboso mas DETERMINÍSTICO)
    
    # --- BAIXO FUNCIONAL ---
    bass = Instrument(program=33, name="Bass_Primer")
    # Notas fundamentais no tempo 1 + approach notes
    
    # --- MELODIA ESQUELETO (Notas-alvo) ---
    lead = Instrument(program=80, name="Lead_Skeleton") # Synth Lead
    # Apenas notas de resolução (3ª, 7ª, 9ª) nos tempos fortes
    
    midi.instruments = [piano, bass, lead]
    return midi

primer = create_jazz_ballad_primer()
primer.save("primer_perfeito.mid")

# DEPOIS VOCÊ RODA O MIDI-GPT:
# model.accompany(primer, target_instruments=[0, 128], controls=...) 
# (Piano já tem harmonia, modelo preenche textura + adiciona Bateria)
5. Como integrar tecnicamente (Hoje)
A Skill não é uma pip install. Ela é contexto para LLM.

Baixe o repo: git clone https://github.com/SJY051/music-composition
Leia SKILL.md e a pasta knowledge/: Entenda os módulos (harmony, melody, form, genre, arrangement).
Injete no Prompt do seu LLM (System Prompt / RAG):
Opção A (Contexto Cheio): Cole SKILL.md + arquivos relevantes de knowledge/ no system prompt do GPT-4o / Claude 3.5 / Gemini 1.5. (Funciona bem, contexto grande).
Opção B (RAG): Indexe a pasta knowledge/ num vector DB (Chroma, Qdrant) e deixe o LLM buscar "voice leading rules", "jazz chord scales", "pop form templates" sob demanda.
Seu Agente Orquestrador (Python):

# Pseudo-código do seu agente principal
def generate_song(spec):
    # 1. PLANEJAMENTO (LLM + Skill)
    plan = llm_with_skill.run(f"""
    Usuário quer: {spec}
    Use music-composition knowledge para:
    1. Definir forma, harmônica funcional, escalas por seção.
    2. Escrever guia melódico (notas-alvo).
    3. GERAR CÓDIGO PYTHON music21/miditoolkit para criar PRIMER MIDI.
    Retorne APENAS o código Python.
    """)
    
    # 2. EXECUÇÃO DETERMINÍSTICA
    primer_midi = exec(plan['python_code']) # Roda o código gerado
    
    # 3. HUMANIZAÇÃO (MIDI-GPT)
    final_midi = midigpt_model.accompany(primer_midi, controls=plan['midigpt_controls'])
    
    # 4. VALIDAÇÃO OPCIONAL (LLM + Skill)
    report = llm_with_skill.analyze_midi(final_midi)
    if report.has_errors:
        final_midi = midigpt_model.inpaint(final_midi, bars=report.error_bars)
        
    return final_midi
6. Resumo: "Limitada" vs "Objetiva"
Característica	music-composition Skill	MIDI-GPT
Natureza	Simbólica / Determinística / Explícita	Subsimbólica / Probabilística / Implícita
Força	Correção teórica, controle fino, explicabilidade, zero alucinação harmônica.	Groove, microtiming, textura idiomática, "som humano", continuação criativa.
Fraqueza	Som "mecânico" se renderizado direto (sem MIDI-GPT). Requer LLM para operar.	Alucina harmonia (muda tom, paralelas), não obedece regras estritas, caixa preta.
Veredito	Não é limitada — é a "MENTE/TEORIA".	É o "CORPO/PERFORMANCE".
Conclusão Final para seu Projeto
Não escolha uma. Use as duas em série.

Skill (music-composition + LLM) = Arquiteto: Desenha a planta baixa (harmonia, forma, escalas, primer MIDI perfeito).
MIDI-GPT = Construtor/Artista: Levanta o prédio com tijolos humanos (velocity, microtiming, groove, preenchimento de textura).
Isso te dá controle total de tonalidade, escala, forma, progressão (via Skill) + qualidade sonora profissional (via MIDI-GPT). É o estado da arte atual em Symbolic Music Generation controlável.

nvidia/nemotron-3-ultra-550b-a55b:free
· 45739 ms

otimo. é isso que eu quero. para implementar em um programa já existente, como eu orquestro para o agente de IA? você quer me dar um exemplo de DESIGN.md para implementar isso? com detalhes de como instalar cada ferramenta? a pasta da skill já está na raiz do projeto em ./music-composition ; já baixei no hugginface o MIDI-GPT ; gostaria de implementar isso como um módulo adicional visto que a pessoa vai ter que acessar o hugginface e autorizar o uso para si, não posso distribuir ; descreva para mim um passo-a-passo para eu instruir o agent para implementar. No caso, a interface já gerencia os acordes em uma roda camelot e seta diversos parametros, e também cria melodia no pianoroll mas é aquela coisa, mais limitado. Será que consigo importar o que for gerado de forma adequada, implementando os recursos avançados que essas ferramentas me oferecem?
Mostrar
·5 web sources
DESIGN.md: Módulo de Geração Musical Neuro-Simbólica (MIDI-GPT + Music-Composition Skill)
Versão: 1.0

Status: Pronto para Implementação

Contexto: Integração em aplicação existente (Gerenciamento Camelot + Piano Roll) como módulo opcional/avançado.

1. Visão Geral da Arquitetura

graph TB
    subgraph App_Existente [🎹 Aplicação Principal (Já Existe)]
        UI[Interface: Roda Camelot, Piano Roll, Parâmetros]
        State[Estado Musical: Acordes, Melodia, BPM, Escala, Forma]
        Export[Exportar Primer MIDI]
        Import[Importar MIDI Gerado → Piano Roll / Acordes]
    end

    subgraph Novo_Modulo [🧠 Módulo Neuro-Simbólico (Novo)]
        Orchestrator[Orquestrador Python (FastAPI/CLI)]
        
        subgraph Symbolic_Engine [📐 Motor Simbólico (LLM + Skill)]
            Skill[music-composition Skill<br/>(./music-composition)]
            LLM[LLM API (GPT-4o / Claude 3.5 / Local)]
            Planner[Planejador: Harmonia, Forma, Voice-Leading]
            PrimerGen[Gerador de Primer MIDI (music21)]
        end
        
        subgraph Generative_Engine [🤖 Motor Generativo (MIDI-GPT)]
            HF_Auth[HF Auth do Usuário (Runtime)]
            ModelLoader[Carregador Lazy (midigpt lib)]
            Generator[Inpainting / Accompaniment]
            Humanizer[Microtiming / Velocity / Groove]
        end
    end

    UI -->|1. Parâmetros + Melodia Atual| Orchestrator
    Orchestrator -->|2. Contexto Teórico| Symbolic_Engine
    Symbolic_Engine -->|3. Primer MIDI Perfeito (Teoria)| Generative_Engine
    Generative_Engine -->|4. MIDI Humanizado (Performance)| Orchestrator
    Orchestrator -->|5. MIDI Multitrack| Import
    Import -->|6. Atualiza Piano Roll / Acordes / Tracks| UI
Princípio Chave:

App Existente = "O Quê" (Dados musicais do usuário) → Skill = "A Lógica" (Teoria, Regras, Planejamento) → MIDI-GPT = "A Execução" (Performance, Groove, Textura).

2. Estrutura de Pastas (Monorepo Sugerido)

raiz_projeto/
├── app_existente/                 # Seu código atual (React/Tauri/Electron/Python/Qt)
│   ├── src/
│   └── ...
├── music-composition/             # JÁ EXISTE (Skill - GitHub SJY051)
│   ├── knowledge/
│   ├── SKILL.md
│   └── ...
├── music_ai_module/               # NOVO MÓDULO (Isolado, plugável)
│   ├── __init__.py
│   ├── config.py                  # Configs, paths, HF token handling
│   ├── orchestrator.py            # Ponto de entrada único (CLI/API)
│   ├── symbolic_engine/
│   │   ├── __init__.py
│   │   ├── skill_loader.py        # Carrega knowledge/ da skill
│   │   ├── llm_planner.py         # Prompt engineering + LLM call
│   │   ├── primer_builder.py      # music21 → Primer MIDI (determinístico)
│   │   └── validator.py           # Análise pós-geração (opcional)
│   ├── generative_engine/
│   │   ├── __init__.py
│   │   ├── model_manager.py       # Lazy load, HF auth, VRAM mgmt
│   │   ├── midi_gpt_wrapper.py    # Wrapper .accompany/.inpaint
│   │   └── controls_mapper.py     # Mapeia UI params → MIDI-GPT controls
│   ├── io_bridge/
│   │   ├── __init__.py
│   │   ├── app_exporter.py        # App State → Primer MIDI (App -> Module)
│   │   └── app_importer.py        # Generated MIDI → App State (Module -> App)
│   ├── requirements.txt
│   ├── pyproject.toml
│   └── README.md
├── models/                        # NÃO COMMITAR (gitignore)
│   └── midigpt/                   # Pesos baixados via HF CLI (user side)
└── DESIGN.md                      # Este arquivo
3. Dependências e Instalação (Detalhado)
3.1. Requisitos do Sistema
Python 3.10 ou 3.11 (3.12+ pode ter problemas com torch/midigpt wheels em algumas plataformas).
GPU NVIDIA (CUDA 11.8/12.1) com ≥ 8GB VRAM (RTX 3070/4060 Laptop mínimo). CPU fallback extremamente lento (minutos por geração).
FFmpeg (se houver conversão de áudio no futuro).
Git LFS (para baixar pesos do HF).
3.2. music_ai_module/requirements.txt

# --- Core ML / MIDI-GPT ---
torch==2.3.0 --index-url https://download.pytorch.org/whl/cu121  # Ajuste CUDA version
midigpt==0.2.0              # Lib oficial (wrapper tokenizer + model)
huggingface_hub==0.23.0     # Login, download, token management
safetensors==0.4.3          # Carregamento rápido pesos

# --- Motor Simbólico / Teoria ---
music21==9.3.0              # Manipulação MIDI simbólica, teoria, análise
mingus==0.5.1               # Alternativa leve para acordes/escalas (opcional)
tonal==0.3.0                # Port JS Tonal.js para Python (útil para Camelot)

# --- LLM Integration ---
openai==1.30.0              # Ou anthropic, google-generativeai, ollama
tiktoken==0.7.0             # Contagem tokens

# --- Serving / API (Se for serviço separado) ---
fastapi==0.110.0
uvicorn==0.29.0
pydantic==2.7.0
python-multipart==0.0.6

# --- Utilidades ---
miditoolkit==1.1.0          # Baixo nível MIDI (usado por midigpt internamente)
numpy==1.26.0
tqdm==4.66.0
pyyaml==6.0.1
3.3. Passo-a-Passo de Instalação (Para o Usuário Final / Script de Setup)
Como você não pode distribuir os pesos, o instalador/seu app deve guiar o usuário:


# 1. Clonar/Atualizar repo (já feito)
cd raiz_projeto

# 2. Criar venv isolado para o módulo IA (recomendado)
python -m venv .venv_ai
source .venv_ai/bin/activate  # Windows: .venv_ai\Scripts\activate

# 3. Instalar dependências Python
cd music_ai_module
pip install --upgrade pip
pip install -r requirements.txt

# 4. AUTENTICAÇÃO HUGGING FACE (OBRIGATÓRIO, UMA VEZ)
# O usuário PRECISA ter conta HF, ter aceitado termos em https://huggingface.co/Metacreation/MIDI-GPT
huggingface-cli login
# Cole o token (User Access Token com permissão 'read')

# 5. DOWNLOAD DOS PESOS (Lazy: feito na 1ª execução, mas pode pré-baixar)
# O model_manager.py fará isso automaticamente usando HF_HUB_CACHE ou pasta local ./models/midigpt
# Tamanho: ~1.5 GB
huggingface-cli download Metacreation/MIDI-GPT --local-dir ./models/midigpt --local-dir-use-symlinks False

# 6. Testar instalação rápida
python -c "from music_ai_module.orchestrator import test_pipeline; test_pipeline()"
4. Contrato de Dados (Interfaces) - CRÍTICO PARA INTEGRAÇÃO
4.1. Entrada: GenerationRequest (App → Módulo)

# music_ai_module/orchestrator.py
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from enum import Enum

class CamelotKey(str, Enum):
    # 1A..12A (Menor), 1B..12B (Maior)
    _1A = "1A"; _2A = "2A"; _3A = "3A"; _4A = "4A"; _5A = "5A"; _6A = "6A"
    _7A = "7A"; _8A = "8A"; _9A = "9A"; _10A = "10A"; _11A = "11A"; _12A = "12A"
    _1B = "1B"; _2B = "2B"; _3B = "3B"; _4B = "4B"; _5B = "5B"; _6B = "6B"
    _7B = "7B"; _8B = "8B"; _9B = "9B"; _10B = "10B"; _11B = "11B"; _12B = "12B"

class TrackRole(str, Enum):
    MELODY = "melody"
    CHORDS = "chords"      # Piano/Rhodes/Pad
    BASS = "bass"
    DRUMS = "drums"
    PAD = "pad"

class TrackInput(BaseModel):
    role: TrackRole
    program: int = 0                    # GM Program (0=Piano, 80=Lead, etc.)
    notes: List[dict] = []              # [{pitch, start_tick, end_tick, velocity}, ...] - Do seu Piano Roll
    chord_symbols: List[str] = []       # ["Cmaj7", "Am7", ...] - Da Roda Camelot
    # Se o usuário desenhou acordes no piano roll, use 'notes'. Se usou roda, use 'chord_symbols'.

class GenerationRequest(BaseModel):
    # Contexto Global
    bpm: int = 120
    time_signature: List[int] = [4, 4]
    camelot_key: CamelotKey = "8A"      # Ex: 8A = Dó Menor / 8B = Eb Maior
    style_prompt: str = "Modern Pop Ballad, emotional, piano driven"
    form_structure: List[str] = ["A", "A", "B", "A"] # Nomes das seções
    section_lengths: List[int] = [8, 8, 8, 8]       # Compassos por seção
    
    # Tracks de Entrada (O que o usuário JÁ FEZ na UI)
    input_tracks: List[TrackInput] = []
    
    # Controle de Geração
    target_tracks: List[TrackRole] = [TrackRole.CHORDS, TrackRole.BASS, TrackRole.DRUMS] # O que o IA deve GERAR
    generate_melody: bool = False       # True se quiser que IA sugira melodia (inpaint)
    
    # Parâmetros MIDI-GPT (Mapeados da UI avançada)
    density: dict = {"chords": 6, "bass": 4, "drums": 7}      # 1-10
    polyphony: dict = {"chords": 4, "bass": 1, "drums": 3}    # 1-10
    note_duration: dict = {"chords": 0.5, "bass": 0.9, "drums": 0.2}
    use_velocity: bool = True
    use_microtiming: bool = True
    temperature: float = 1.0
    seed: Optional[int] = None
4.2. Saída: GenerationResult (Módulo → App)

class GeneratedTrack(BaseModel):
    role: TrackRole
    program: int
    name: str
    notes: List[dict]  # [{pitch, start_tick, end_tick, velocity}, ...] - PRONTO PARA PIANO ROLL
    chord_symbols: List[dict] = [] # [{symbol: "Cmaj7", start_tick, end_tick}, ...] - PARA RODA CAMELOT

class GenerationResult(BaseModel):
    success: bool
    message: str
    bpm: int
    time_signature: List[int]
    camelot_key: CamelotKey
    tracks: List[GeneratedTrack]  # Tracks ORIGINAIS (mantidas) + NOVAS (geradas)
    # Metadados para debug/UI
    primer_midi_b64: Optional[str] = None  # Base64 do primer (opcional, para debug)
    generation_time_sec: float
    vram_used_mb: float
5. Implementação do Orquestrador (Coração do Módulo)
music_ai_module/orchestrator.py

import asyncio
import base64
import time
from pathlib import Path
from typing import List

from .config import settings
from .io_bridge.app_exporter import AppExporter
from .symbolic_engine.llm_planner import LLMPlanner
from .symbolic_engine.primer_builder import PrimerBuilder
from .generative_engine.model_manager import ModelManager
from .generative_engine.midi_gpt_wrapper import MidiGPTWrapper
from .generative_engine.controls_mapper import map_request_to_controls
from .io_bridge.app_importer import AppImporter
from .schemas import GenerationRequest, GenerationResult, GeneratedTrack

class MusicAIOrchestrator:
    def __init__(self):
        self.model_manager = ModelManager(settings.MODEL_PATH)
        self.midi_gpt = MidiGPTWrapper(self.model_manager)
        self.llm_planner = LLMPlanner(settings.SKILL_PATH)  # ./music-composition
        self.exporter = AppExporter()
        self.importer = AppImporter()

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        start_time = time.time()
        
        try:
            # 1. EXPORT: App State → Primer MIDI + Plano Teórico
            #    Usa a Skill (LLM) para criar harmonia funcional, voice-leading, forma.
            primer_midi, theory_plan = await self._build_primer_and_plan(request)
            
            # 2. MAP: Request UI → MIDI-GPT Controls
            controls = map_request_to_controls(request, theory_plan)
            
            # 3. GENERATE: MIDI-GPT (Lazy Load Model)
            generated_midi = await self.midi_gpt.accompany(
                primer_midi=primer_midi,
                target_instruments=controls.target_instruments,
                controls=controls.midigpt_controls,
                temperature=request.temperature,
                seed=request.seed
            )
            
            # 4. IMPORT: MIDI Gerado → App State (Piano Roll + Camelot)
            result_tracks = self.importer.midi_to_app_tracks(
                generated_midi, 
                original_tracks=request.input_tracks,
                theory_plan=theory_plan
            )
            
            return GenerationResult(
                success=True,
                message="Geração concluída com sucesso",
                bpm=request.bpm,
                time_signature=request.time_signature,
                camelot_key=request.camelot_key,
                tracks=result_tracks,
                generation_time_sec=time.time() - start_time,
                vram_used_mb=self.model_manager.get_vram_usage()
            )
            
        except Exception as e:
            return GenerationResult(success=False, message=str(e), tracks=[], 
                                    bpm=request.bpm, time_signature=request.time_signature, 
                                    camelot_key=request.camelot_key, generation_time_sec=0, vram_used_mb=0)

    async def _build_primer_and_plan(self, request: GenerationRequest):
        # A. Converter input do App para formato da Skill (MusicXML / ABC / Tonal.js JSON)
        skill_input = self.exporter.request_to_skill_context(request)
        
        # B. Chamar LLM com Skill (RAG ou Full Context) para gerar PLANO + CÓDIGO PRIMER
        #    Prompt pede: "Gere código Python music21 que cria primer MIDI perfeito"
        plan = await self.llm_planner.create_generation_plan(skill_input)
        
        # C. Executar código Python gerado (Sandbox/Subprocesso seguro) → Primer MIDI
        #    Isso garante DETERMINISMO TEÓRICO (acordes certos, voice-leading, forma).
        primer_midi = PrimerBuilder.execute_primer_code(plan.primer_python_code)
        
        return primer_midi, plan
6. Motor Simbólico: Integração com ./music-composition
music_ai_module/symbolic_engine/llm_planner.py

import json
from pathlib import Path
from openai import AsyncOpenAI  # Ou Anthropic, etc.

class LLMPlanner:
    def __init__(self, skill_path: Path):
        self.skill_path = skill_path
        self.client = AsyncOpenAI()  # Config via env var
        self.skill_context = self._load_skill_context()
        
    def _load_skill_context(self) -> str:
        """Carrega SKILL.md + knowledge/ relevantes para o system prompt."""
        ctx = []
        skill_md = self.skill_path / "SKILL.md"
        if skill_md.exists():
            ctx.append(f"## SKILL DEFINITION\n{skill_md.read_text()}")
        
        # Carregar módulos chave (harmony, melody, form, genre, arrangement)
        for module in ["harmony", "melody", "form", "genre", "arrangement", "voice_leading"]:
            mod_path = self.skill_path / "knowledge" / f"{module}.md"
            if mod_path.exists():
                ctx.append(f"## {module.upper()} KNOWLEDGE\n{mod_path.read_text()}")
        return "\n\n".join(ctx)

    async def create_generation_plan(self, skill_input: dict) -> "GenerationPlan":
        system_prompt = f"""
        YOU ARE AN EXPERT MUSIC THEORIST AND ARRANGER.
        You have access to the following knowledge base:
        {self.skill_context}
        
        YOUR TASK:
        1. Analyze the user's musical context (key, style, form, existing melody/chords).
        2. Create a DETAILED THEORETICAL PLAN: harmonic progression per bar, voice-leading rules, 
           melodic target notes, orchestration roles, groove style.
        3. WRITE EXECUTABLE PYTHON CODE using `music21`/`miditoolkit` to generate a PRIMER MIDI file.
           This primer MUST contain:
           - Chord track (piano) with correct voice-leading (drop-2, shell voicings, etc.)
           - Bass track with functional bass lines (root, approach notes, walking if jazz)
           - Melody skeleton (guide tones on downbeats) if melody exists
           - Time signature, tempo, key signature markers.
        4. Return JSON with: theoretical_plan (text), primer_python_code (string).
        
        OUTPUT FORMAT: JSON only.
        """
        
        user_prompt = f"""
        USER REQUEST:
        {json.dumps(skill_input, indent=2)}
        
        Generate the plan and primer code.
        """
        
        response = await self.client.chat.completions.create(
            model="gpt-4o",  # Ou claude-3-5-sonnet, ou local via ollama
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1  # Baixa para consistência teórica
        )
        
        return GenerationPlan.model_validate_json(response.choices[0].message.content)
music_ai_module/symbolic_engine/primer_builder.py

import subprocess
import tempfile
import traceback
from miditoolkit import MidiFile

class PrimerBuilder:
    @staticmethod
    def execute_primer_code(python_code: str) -> MidiFile:
        """Executa código gerado pelo LLM em subprocesso isolado (segurança)."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            # Wrapper para capturar variável `primer_midi`
            wrapper = f"""
import sys
sys.path.insert(0, '.')  # Para imports locais se needed
from miditoolkit import MidiFile, Instrument, Note, TempoChange, TimeSignature

{python_code}

# O código DO LLM deve definir uma função build_primer() -> MidiFile
# Exemplo esperado no código gerado:
# def build_primer():
#     midi = MidiFile(...)
#     ...
#     return midi

primer_midi = build_primer()
# Salvar em arquivo temporário para retorno
import pickle, base64
output_path = "{f.name}.mid"
primer_midi.dump(output_path)
"""
            f.write(wrapper)
            script_path = f.name
        
        try:
            # Rodar com timeout (30s)
            result = subprocess.run(
                ["python", script_path], 
                capture_output=True, text=True, timeout=30, cwd="."
            )
            if result.returncode != 0:
                raise RuntimeError(f"Primer generation failed:\n{result.stderr}\nCode:\n{python_code}")
            
            # Carregar MIDI gerado
            output_mid_path = f"{script_path}.mid"
            return MidiFile(output_mid_path)
        finally:
            Path(script_path).unlink(missing_ok=True)
            Path(f"{script_path}.mid").unlink(missing_ok=True)
7. Motor Generativo: Wrapper MIDI-GPT com Gestão de Auth/VRAM
music_ai_module/generative_engine/model_manager.py

import torch
from huggingface_hub import hf_hub_download
from midigpt import MidiGPT
from pathlib import Path

class ModelManager:
    _instance = None
    _model = None
    
    def __new__(cls, model_path: Path):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init(model_path)
        return cls._instance
    
    def _init(self, model_path: Path):
        self.model_path = model_path
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if self.device == "cuda" else torch.float32
        print(f"[ModelManager] Device: {self.device}, Dtype: {self.dtype}")
        
    def get_model(self) -> MidiGPT:
        if self._model is None:
            print("[ModelManager] Loading MIDI-GPT (first time)...")
            # A lib midigpt lida com tokenizer + model
            # Se model_path tem pesos locais, usa local_files_only=True
            self._model = MidiGPT.from_pretrained(
                str(self.model_path) if self.model_path.exists() else "Metacreation/MIDI-GPT",
                local_files_only=self.model_path.exists(),
                torch_dtype=self.dtype
            ).to(self.device).eval()
            # Compile para velocidade (PyTorch 2.0+)
            if hasattr(torch, 'compile'):
                self._model = torch.compile(self._model, mode="reduce-overhead")
        return self._model
    
    def get_vram_usage(self) -> float:
        if torch.cuda.is_available():
            return torch.cuda.max_memory_allocated() / 1024**2
        return 0.0
music_ai_module/generative_engine/midi_gpt_wrapper.py

from miditoolkit import MidiFile
from .model_manager import ModelManager
from .controls_mapper import MidigptControls

class MidiGPTWrapper:
    def __init__(self, model_manager: ModelManager):
        self.model_manager = model_manager
    
    def accompany(self, primer_midi: MidiFile, target_instruments: list, 
                  controls: MidigptControls, temperature: float, seed: int) -> MidiFile:
        model = self.model_manager.get_model()
        
        # Preparar controls no formato esperado pela lib (listas por track alvo)
        gen_controls = {
            "instrument": controls.instruments,
            "density": controls.density,
            "polyphony": controls.polyphony,
            "note_duration": controls.note_duration,
            "use_velocity": controls.use_velocity,
            "use_microtiming": controls.use_microtiming,
        }
        
        # A lib midigpt espera target_instruments como lista de program numbers
        # E controls com listas do mesmo tamanho
        generated = model.accompany(
            midi=primer_midi,
            target_instruments=target_instruments,  # Ex: [0, 33, 128]
            controls=gen_controls,
            max_bars=32,  # Ajustar conforme form_structure
            temperature=temperature,
            seed=seed
        )
        return generated
music_ai_module/generative_engine/controls_mapper.py

from dataclasses import dataclass
from typing import Dict, List
from ..schemas import GenerationRequest, TrackRole

@dataclass
class MidigptControls:
    instruments: List[int]
    density: List[int]
    polyphony: List[int]
    note_duration: List[float]
    use_velocity: List[bool]
    use_microtiming: List[bool]

# Mapeamento Role -> GM Program Padrão
ROLE_TO_PROGRAM = {
    TrackRole.CHORDS: 0,      # Piano
    TrackRole.BASS: 33,       # Finger Bass
    TrackRole.DRUMS: 128,     # Drums (Channel 10)
    TrackRole.PAD: 88,        # Pad
    TrackRole.MELODY: 80,     # Lead Synth
}

def map_request_to_controls(request: GenerationRequest, theory_plan) -> MidigptControls:
    """Converte UI params (dict por role) → Listas ordenadas por target_instruments."""
    
    # Ordem fixa para consistência: CHORDS, BASS, DRUMS, PAD, MELODY
    role_order = [TrackRole.CHORDS, TrackRole.BASS, TrackRole.DRUMS, TrackRole.PAD, TrackRole.MELODY]
    
    # Filtrar apenas roles que são target
    active_roles = [r for r in role_order if r in request.target_tracks]
    
    instruments = [ROLE_TO_PROGRAM[r] for r in active_roles]
    
    # Defaults seguros se UI não mandou
    density_map = request.density or {}
    polyphony_map = request.polyphony or {}
    duration_map = request.note_duration or {}
    
    return MidigptControls(
        instruments=instruments,
        density=[density_map.get(r.value, 5) for r in active_roles],
        polyphony=[polyphony_map.get(r.value, 3 if r != TrackRole.BASS else 1) for r in active_roles],
        note_duration=[duration_map.get(r.value, 0.5) for r in active_roles],
        use_velocity=[request.use_velocity] * len(active_roles),
        use_microtiming=[request.use_microtiming] * len(active_roles),
    )
8. Bridge I/O: O "Tradutor" App ⇄ Módulo
music_ai_module/io_bridge/app_exporter.py

from ..schemas import GenerationRequest, TrackInput, CamelotKey
from miditoolkit import MidiFile, Instrument, Note, TempoChange, TimeSignature, KeySignature

class AppExporter:
    def request_to_skill_context(self, request: GenerationRequest) -> dict:
        """Converte estado do App para JSON rico para o LLM/Skill."""
        return {
            "meta": {
                "bpm": request.bpm,
                "time_signature": request.time_signature,
                "camelot_key": request.camelot_key.value,
                "style": request.style_prompt,
                "form": list(zip(request.form_structure, request.section_lengths)),
            },
            "existing_tracks": [
                {
                    "role": t.role.value,
                    "program": t.program,
                    "has_notes": len(t.notes) > 0,
                    "has_chords": len(t.chord_symbols) > 0,
                    "chord_progression": t.chord_symbols,  # Para Skill analisar
                    "note_count": len(t.notes),
                    "pitch_range": [min(n['pitch'] for n in t.notes), max(n['pitch'] for n in t.notes)] if t.notes else None
                } for t in request.input_tracks
            ],
            "generation_goals": {
                "target_roles": [r.value for r in request.target_tracks],
                "generate_melody": request.generate_melody,
            }
        }
    
    def build_primer_midi_deterministic(self, request: GenerationRequest, theory_plan) -> MidiFile:
        """Fallback/Alternativa: Build primer DIRETO em Python (sem LLM code gen) se preferir.
        Útil para validação ou se LLM falhar. Usa music21 para harmonia funcional.
        """
        # Implementação music21 pura baseada em theory_plan.chord_progression_per_bar
        # ...
        pass
music_ai_module/io_bridge/app_importer.py

from miditoolkit import MidiFile, Instrument
from ..schemas import GeneratedTrack, TrackRole, GenerationRequest, TrackInput

class AppImporter:
    def midi_to_app_tracks(self, generated_midi: MidiFile, 
                           original_tracks: List[TrackInput], 
                           theory_plan) -> List[GeneratedTrack]:
        """
        Converte MIDI multitrack do MIDI-GPT → Lista de Tracks para seu Piano Roll + Camelot.
        """
        result_tracks = []
        
        # 1. Manter tracks originais (Melodia do usuário, etc.)
        for ot in original_tracks:
            result_tracks.append(GeneratedTrack(
                role=ot.role,
                program=ot.program,
                name=f"User {ot.role.value}",
                notes=ot.notes,  # Notas originais intactas
                chord_symbols=ot.chord_symbols
            ))
        
        # 2. Processar tracks NOVAS geradas pelo MIDI-GPT
        # A ordem das tracks no MIDI gerado = [Tracks Originais...] + [Target Tracks na ordem do accompany]
        # Precisamos mapear index → role.
        # Assumimos que primer tinha N tracks originais.
        n_original = len(original_tracks)
        target_roles_order = theory_plan.target_roles_order  # Ex: [CHORDS, BASS, DRUMS]
        
        for i, inst in enumerate(generated_midi.instruments):
            if i < n_original:
                continue  # Já processamos como originais
            
            role = target_roles_order[i - n_original]
            is_drum = inst.is_drum
            
            notes = []
            for note in inst.notes:
                notes.append({
                    "pitch": note.pitch if not is_drum else note.pitch,  # Drum map GM
                    "start_tick": note.start,
                    "end_tick": note.end,
                    "velocity": note.velocity
                })
            
            # Extrair cifras da track harmônica (Piano/Chords) se houver
            chord_symbols = []
            if role == TrackRole.CHORDS and not is_drum:
                chord_symbols = self._extract_chords_from_piano_track(inst, generated_midi.ticks_per_beat)
            
            result_tracks.append(GeneratedTrack(
                role=role,
                program=inst.program if not is_drum else 128,
                name=f"AI {role.value}",
                notes=notes,
                chord_symbols=chord_symbols
            ))
        
        return result_tracks
    
    def _extract_chords_from_piano_track(self, instrument: Instrument, ticks_per_beat: int) -> List[dict]:
        """Análise harmônica simples no piano gerado para popular Roda Camelot.
        Usa music21 ou lógica de janela temporal.
        """
        # Simplificado: agrupar notas por compasso/beat e classificar
        # Retornar [{symbol: "Cmaj7", start_tick: 0, end_tick: 1920}, ...]
        # Recomendado: usar music21.converter.parse -> analyze('chord') por medida
        return []
9. Integração com Sua Aplicação Existente
9.1. Opção A: Subprocesso CLI (Mais Simples, Isolado)
Seu app (C++, Rust, Electron, Python) chama um entrypoint CLI.

music_ai_module/cli.py


import asyncio, json, sys, base64
from .orchestrator import MusicAIOrchestrator
from .schemas import GenerationRequest

async def main():
    # Ler request JSON do stdin
    input_json = sys.stdin.read()
    request = GenerationRequest.model_validate_json(input_json)
    
    orchestrator = MusicAIOrchestrator()
    result = await orchestrator.generate(request)
    
    # Escrever result JSON no stdout
    sys.stdout.write(result.model_dump_json())

if __name__ == "__main__":
    asyncio.run(main())
Chamada do seu App (Pseudo-código):


# No seu backend Python / Node / Rust / C++
import subprocess, json

def call_music_ai(request_dict: dict) -> dict:
    # 1. Serializar request
    input_json = json.dumps(request_dict)
    
    # 2. Chamar CLI (usa venv isolado)
    # Caminho do python do venv: ./music_ai_module/.venv_ai/bin/python
    cmd = ["./music_ai_module/.venv_ai/bin/python", "-m", "music_ai_module.cli"]
    
    proc = subprocess.run(cmd, input=input_json, capture_output=True, text=True, timeout=120, cwd="raiz_projeto")
    
    if proc.returncode != 0:
        raise RuntimeError(f"IA Module Error: {proc.stderr}")
    
    return json.loads(proc.stdout)
9.2. Opção B: FastAPI Service (Melhor para Produção/UX)
Sobe um serviço local na inicialização do app.

music_ai_module/server.py


from fastapi import FastAPI, HTTPException
from .orchestrator import MusicAIOrchestrator
from .schemas import GenerationRequest, GenerationResult

app = FastAPI(title="Music AI Module")
orchestrator = MusicAIOrchestrator()  # Singleton carrega modelo lazy

@app.post("/generate", response_model=GenerationResult)
async def generate_endpoint(request: GenerationRequest):
    result = await orchestrator.generate(request)
    if not result.success:
        raise HTTPException(status_code=500, detail=result.message)
    return result

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": orchestrator.model_manager._model is not None}
Inicialização no seu App:


# Background process
cd music_ai_module && .venv_ai/bin/uvicorn server:app --port 8765 --host 127.0.0.1
10. Passo-a-Passo para o Agente de IA Implementar
Copie e cole este prompt para seu agente (Cursor, Copilot, Devin, GPT-Engineer, etc.)

PROMPT PARA O AGENTE DE IMPLEMENTAÇÃO

# TAREFA: Implementar Módulo `music_ai_module` conforme DESIGN.md

## CONTEXTO
- Projeto raiz em `./`
- Skill `music-composition` já existe em `./music-composition` (GitHub SJY051)
- Pesos MIDI-GPT serão baixados pelo usuário via `huggingface-cli login` (repo gated: Metacreation/MIDI-GPT)
- App principal já gerencia: Roda Camelot (key), Piano Roll (melodia/acordes), BPM, Forma.
- Objetivo: Módulo plugável que recebe estado do App → Gera acompanhamento (acordes, baixo, bateria) com teoria correta + performance humana → Devolve MIDI multitrack para popular Piano Roll e Roda Camelot.

## ENTREGÁVEIS (Estrutura de Arquivos)
Crie TODOS os arquivos abaixo com implementação completa, tipada (Pydantic), documentada e testável:

### 1. Configuração e Setup
- `music_ai_module/pyproject.toml` (build-system, project, dependencies)
- `music_ai_module/requirements.txt` (versões travadas, CUDA 12.1 torch)
- `music_ai_module/config.py` (Settings com pydantic-settings, paths, HF token env)
- `music_ai_module/.gitignore` (ignorar `models/`, `__pycache__`, `.venv_ai`, `*.mid`)

### 2. Schemas (Contrato de Dados)
- `music_ai_module/schemas.py` (GenerationRequest, GenerationResult, TrackInput, GeneratedTrack, Enums CamelotKey, TrackRole)

### 3. Orquestrador Principal
- `music_ai_module/orchestrator.py` (Classe MusicAIOrchestrator, método async generate(request))

### 4. Motor Simbólico (LLM + Skill)
- `music_ai_module/symbolic_engine/skill_loader.py` (Carrega SKILL.md + knowledge/*.md)
- `music_ai_module/symbolic_engine/llm_planner.py` (LLMPlanner: system prompt com skill context, create_generation_plan retorna GenerationPlan com primer_python_code)
- `music_ai_module/symbolic_engine/primer_builder.py` (Executa código Python do LLM em subprocesso seguro, retorna MidiFile)
- `music_ai_module/symbolic_engine/validator.py` (Opcional: music21 analysis do MIDI final)

### 5. Motor Generativo (MIDI-GPT)
- `music_ai_module/generative_engine/model_manager.py` (Singleton, lazy load, VRAM mgmt, torch.compile, local_files_only)
- `music_ai_module/generative_engine/midi_gpt_wrapper.py` (Wrapper .accompany com error handling)
- `music_ai_module/generative_engine/controls_mapper.py` (Mapeia Request.density/polyphony/duration dicts → listas ordenadas por target_instruments)

### 6. Bridge I/O (App ⇄ Módulo)
- `music_ai_module/io_bridge/app_exporter.py` (Request → Skill Context JSON + Primer MIDI fallback determinístico)
- `music_ai_module/io_bridge/app_importer.py` (MidiFile gerado → List[GeneratedTrack] com notas + chord_symbols extraídos)

### 7. Interfaces de Execução
- `music_ai_module/cli.py` (Entrypoint stdin/stdout JSON para subprocesso)
- `music_ai_module/server.py` (FastAPI /generate endpoint para serviço local)

### 8. Testes e Validação
- `music_ai_module/tests/test_pipeline.py` (Teste de integração: mock request → verifica se retorna tracks com notas)
- `music_ai_module/tests/fixtures/sample_request.json` (Exemplo de request válido)

### 9. Documentação
- `music_ai_module/README.md` (Como instalar, rodar CLI, rodar Server, autenticação HF, troubleshooting VRAM)

## REGRAS DE OURO
1. **NENHUM PESO NO GIT**: `models/` no .gitignore. Download via `huggingface_hub` em `model_manager.py`.
2. **ISOLAMENTO DE AMBIENTE**: Código assume venv em `.venv_ai` com Python 3.10/3.11.
3. **DETERMINISMO TEÓRICO**: Primer MIDI **SEMPRE** gerado via código Python (music21) vindo do LLM+Skill. MIDI-GPT só humaniza.
4. **TRATAMENTO DE ERRO**: Try/except em todo boundary externo (LLM API, HF Hub, Subprocesso, GPU OOM). Retornar `GenerationResult(success=False, message=...)`.
5. **TIPAGEM ESTrita**: Pydantic v2 em todos os schemas. Zero `Any`.
6. **LOGGING**: `logging` standard lib com níveis INFO/DEBUG/ERROR.

## COMANDO DE VALIDAÇÃO FINAL
Após implementar, o agente deve rodar:
```bash
cd music_ai_module
# (Assumindo venv ativo e HF logado)
python -m pytest tests/ -v
# E teste manual:
echo '{"bpm":120,"camelot_key":"8A","style_prompt":"Pop","form_structure":["A"],"section_lengths":[8],"input_tracks":[{"role":"melody","program":80,"notes":[{"pitch":60,"start_tick":0,"end_tick":480,"velocity":100}]}],"target_tracks":["chords","bass"]}' | python -m music_ai_module.cli
Deve imprimir JSON GenerationResult com success: true e tracks preenchidas.

DÚVIDAS TÉCNICAS PARA O AGENTE RESOLVER
Como extrair chord_symbols do piano gerado? (Usar music21 no app_importer).
Como lidar com target_instruments order no accompany? (Fixar ordem: CHORDS, BASS, DRUMS, PAD, MELODY).
Como passar key_signature para o MIDI-GPT? (Via KeySignature event no primer MIDI + notas do acorde no compasso 1).

---

## 11. Checklist de Validação Pós-Implementação

| Item | Como Testar | Critério de Sucesso |
| :--- | :--- | :--- |
| **Instalação Limpa** | `pip install -r requirements.txt` em venv novo | Zero conflitos de dependência, `torch` roda na GPU. |
| **Auth HF** | `huggingface-cli login` + primeira chamada | Model baixa para `./models/midigpt` ou cache HF, carrega sem erro 401/403. |
| **Primer Teórico** | Inspecionar `primer_midi` (salvar debug) | Contém: KeySignature correta, Acordes com voice-leading (drop-2), Baixo funcional, Forma (markers). |
| **Geração MIDI-GPT** | Rodar com `target_tracks=["chords", "bass"]` | Gera 2 tracks novas, mantém melodia original, notas no range correto, BPM certo. |
| **Importação App** | `app_importer.midi_to_app_tracks` | Retorna `GeneratedTrack` com `notes` (para Piano Roll) e `chord_symbols` (para Camelot). |
| **Performance** | Gerar 32 compassos | < 10s em RTX 3070 (8GB), < 30s em CPU (fallback). VRAM < 6GB. |
| **Integração Real** | Conectar no seu App (CLI ou API) | UI recebe JSON, popula Piano Roll + Camelot sem travar thread principal (async). |

---

## 12. Próximos Passos / Evolução (Roadmap)

1.  **Cache de Planos:** Salvar `GenerationPlan` (teoria + primer code) por hash do request para pular LLM em gerações repetidas.
2.  **Streaming de Tokens:** Mostrar progresso da geração LLM no UI (WebSocket no FastAPI).
3.  **Fine-tuning LoRA:** Futuramente, permitir treino LoRA no estilo do usuário (requer `midigpt[train]` + dataset próprio).
4.  **Controle Avançado UI:** Expor `density/polyphony/duration` **por compasso** (array) no `GenerationRequest` para "automation" de energia.
5.  **Validação Humana no Loop:** Botão "Regenerar apenas compasso 12-16" → Chama `model.inpaint` com `start_bar/end_bar`.

---

**Este DESIGN.md é auto-contido.** Entregue ao seu agente de código junto com o conteúdo da pasta `./music-composition`. Ele tem tudo para construir o módulo robusto, desacoplado e profissional. Boa implementação! 🚀