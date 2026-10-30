/** Manual do usuário da Plataforma ASP (gerado a partir do manual.md do
 *  Manual-do-Usuario-Plataforma-ASP.docx). Base de conhecimento do
 *  assistente — atualizar junto com o manual. */
export const MANUAL_USUARIO = `# Manual do Usuário — Plataforma ASP

Oct 30, 2026 · @Douglas Tanaka

## Índice

1. Introdução
2. Acesso ao sistema
3. Navegação e uso no celular
4. Clientes e contatos
5. Projetos
6. Ordens de Serviço (OS) e fases
7. Agendamento (fases 2 e 6)
8. Coleta de dados da inspeção (fase 3)
9. Relatórios (fases 4 e 8)
10. Aprovação e versão assinada (fases 5 e 9)
11. Execução em campo (fase 7)
12. Encerramento e entregas (fase 10)
13. Catálogo
14. Administração (somente Administrador)
15. Dashboard de Operações, Arquivos e Lixeira
16. Perguntas frequentes

## 1. Introdução

A Plataforma ASP organiza todo o trabalho de inspeção e limpeza de tanques: do cadastro do cliente à entrega dos documentos finais. Este manual mostra, passo a passo, como cada pessoa usa o sistema no seu dia a dia.

**Como o trabalho está organizado**

- **Cliente**: a empresa atendida, com CNPJ, endereço e contatos.
- **Projeto**: um pedido de compra do cliente. Recebe um código no formato NN/INICIAIS/AA (ex.: 57/MG/26).
- **Ordem de Serviço (OS)**: cada tanque ou ponto atendido dentro do projeto. A OS percorre as fases de 2 a 10, da visita de inspeção ao encerramento.

**Perfis de acesso** (definem o que cada pessoa pode fazer)

| Perfil | Atua principalmente em |
| --- | --- |
| Comercial | Clientes, projetos, agendamentos, entregas e encerramento |
| Operações | Coleta de dados, relatórios, execução em campo e RDO |
| Gerência | Aprovações, versão assinada e acompanhamento geral |
| Administrador | Tudo, incluindo usuários, funções e permissões |

**Funções** (cargo da pessoa na equipe): Coordenador, Engenheiro, Técnico, Auxiliar e Supervisor. Algumas permissões vêm da função — por exemplo, Técnicos e Auxiliares registram medições, fotos e RDO durante a execução. O Administrador ajusta isso na aba **Permissões por função** (seção 14).

**Avisos do sistema**: o símbolo ⛔ indica algo que impede salvar ou avançar; o símbolo ⚠️ é apenas um alerta e não bloqueia nada. As mensagens aparecem ao lado do campo com problema.

## 2. Acesso ao sistema

O acesso começa por um convite enviado por e-mail; ninguém recebe senha por e-mail. O endereço do sistema é **asp-plataform.vercel.app**.

**Primeiro acesso (convite)**

1. O Administrador cadastra você em Administração de usuários.
2. Você recebe o e-mail "Bem-vindo à Plataforma ASP — crie sua senha". Confira também o spam.
3. Clique em **Criar minha senha**, digite a senha duas vezes (mínimo de 6 caracteres) e confirme.
4. Você entra direto no sistema.

O link do convite vale **24 horas** e só pode ser usado uma vez. Se venceu, peça ao Administrador para **Reenviar convite**.

**Entrar no dia a dia**: na tela de login, informe e-mail e senha e clique em **Entrar**. O ícone de olho mostra ou esconde a senha.

**Esqueci minha senha**

1. Na tela de login, clique em **Esqueci minha senha**.
2. Digite seu e-mail e envie. A resposta é sempre a mesma, por segurança.
3. Abra o e-mail e clique no link (vale **1 hora**).
4. Defina a nova senha.

Há limite de 3 pedidos a cada 15 minutos por e-mail. Se o e-mail não chegar, o Administrador pode gerar o link em **Enviar link de redefinição** e enviá-lo por outro meio.

**Meu perfil**: no menu do seu nome, você pode corrigir seu nome completo (nome e sobrenome). Perfil, função e e-mail só o Administrador altera.

**Sair**: clique em **Sair** no canto superior direito. Em computadores compartilhados, sempre saia ao terminar.

## 3. Navegação e uso no celular

Todas as áreas ficam na barra azul do topo; no celular, elas ficam no botão de menu (☰).

**Barra superior**

- **Abas**: Dashboard, Projetos, Arquivos, Catálogo e Lixeira. Clientes, Histórico e Administração abrem em janelas.
- **💬 Feedback**: envie erros e sugestões para a equipe do sistema.
- **🔔 Notificações**: avisos de agendamentos, remarcações, relatórios e lembretes. O número mostra quantas estão sem ler.
- **☀️ / 🌙 Tema**: alterna entre claro e escuro.
- **Seu nome**: abre Meu perfil. Ao lado fica o botão **Sair**.

**Instalar como aplicativo (recomendado no celular)**

- **Android (Chrome)**: abra o site, toque no menu ⋮ e escolha **Instalar app** ou **Adicionar à tela inicial**.
- **iPhone (Safari)**: toque em **Compartilhar** e escolha **Adicionar à Tela de Início**.
- Ao instalar, permita as **notificações** para receber os avisos no celular.

**Sem internet (offline)**: em campo, você pode continuar registrando medições, fotos e RDOs. Os dados ficam numa fila no aparelho e são enviados sozinhos quando a conexão volta. O indicador ⏳ na barra mostra quantos itens estão pendentes — não feche o app nem limpe os dados do navegador enquanto houver pendências.

## 4. Clientes e contatos

Todo projeto começa por um cliente cadastrado; cadastre-o uma vez e reaproveite em todos os projetos.

**Cadastrar cliente** (menu Clientes → **+ Novo cliente**)

1. Preencha **Razão social**, **CNPJ**, **Cidade**, **UF** e **Endereço**.
2. Adicione ao menos um **contato** com nome, cargo e e-mail (telefone é opcional).
3. Se o serviço se repete, marque **Serviço recorrente** e escolha a periodicidade: 3, 6 ou 12 meses.
4. Salve.

O sistema bloqueia CNPJ inválido ou já cadastrado e avisa quando a razão social é parecida com a de outro cliente. A cidade é padronizada ao salvar; se já existir com outra grafia na mesma UF, aparece o botão **Usar "…"**.

**Cliente recorrente**: o primeiro projeto vem com inspeção e os seguintes vêm sem inspeção. O Comercial recebe um aviso 30 dias antes de vencer o próximo serviço, contado a partir do fim da última execução.

**Contatos**

- **Editar**: renomear um contato que é responsável de projetos pede confirmação e atualiza esses projetos.
- **Desativar**: o contato some das novas escolhas, mas continua nos registros antigos. Use **Reativar** para voltar.
- **Excluir**: só é permitido se o contato nunca foi usado.

**Aviso do cliente**: uma faixa de até 500 caracteres que aparece em todas as OSs desse cliente — útil para regras de acesso, horários ou exigências de segurança.

**Excluir cliente**: não é possível enquanto houver projetos em andamento. O cliente vai para a Lixeira e pode ser restaurado em até 30 dias.

## 5. Projetos

Um projeto corresponde a um pedido de compra do cliente e reúne as OSs (tanques) atendidas nele. Quem abre projetos: Comercial, Gerência e Administrador.

**Abrir projeto** (Projetos → **+ Novo projeto**)

1. Escolha o **cliente** na lista. Se ainda não existir, use **+ Cadastrar**.
2. Responda **Usar dados do contato do cliente?**. Com **Sim**, escolha o contato e clique em **Usar como está**, **Atualizar contato** ou **+ Novo contato**. Com **Não**, digite responsável e endereço.
3. Confira o **código do projeto** sugerido (ex.: 57/MG/26: número sequencial do ano / suas iniciais / ano). Pode editar, mas o código não pode se repetir.
4. Informe o **pedido de compra** (obrigatório) e a **data de abertura**.
5. Responda **Haverá inspeção?**. A resposta vem sugerida conforme o cliente (recorrente com projeto anterior → Não).
6. Clique em **Abrir projeto**.

**Lista de projetos**: busque por código, pedido, cliente ou endereço; filtre por cliente e status; agrupe por cliente. Os status são: em andamento, **Em encerramento** (todas as OSs na fase 10, ainda não encerradas) e **Concluído** (todas as OSs encerradas — automático).

**Editar projeto**: na página do projeto, use **Editar**. As mesmas regras valem na edição. Mudar "Haverá inspeção?" no projeto só afeta as OSs criadas depois.

## 6. Ordens de Serviço (OS) e fases

Cada tanque ou ponto atendido é uma OS, e ela avança por fases de 2 a 10; uma OS sem inspeção começa direto na fase 6.

**Criar uma OS** (página do projeto → **+ Nova OS**)

1. **Identificação** do tanque (ex.: TQ-01). Não pode repetir no projeto: "TQ-01" e "tq 01" contam como iguais.
2. **Procedimento** do Catálogo (obrigatório).
3. **Dados do tanque**: formato, diâmetro ou comprimento e largura, altura, capacidade e material.
4. **Haverá inspeção?**: vem preenchido pelo projeto e pode ser trocado em cada OS.

**A página da OS**

- **Cabeçalho**: identificação, cliente, procedimento e tanque (clique no ✎ para editar), aviso do cliente, fase atual e a barra **Ações desta fase** com o botão principal (ex.: **Concluir e avançar**).
- **Seções**: Coletas, Agendamentos, Checklist, Fotos da execução, RDOs, Relatórios, Entregas, Arquivos e Histórico. Elas abrem e fecham sozinhas conforme a fase; use **Expandir tudo**, **Recolher tudo** ou **Restaurar padrão**.
- **Avisos de fase**: ao avançar, o sistema lista pendências (ex.: fotos incompletas, dias sem RDO). Avisos ⚠️ deixam seguir; erros ⛔ impedem.
- **Modo consulta**: quem não atua na fase atual vê a OS, mas sem os botões de ação.

**Trocar "Haverá inspeção?" depois**: Comercial, Gerência e Administrador podem trocar com o ✎. A troca pede confirmação, fica no histórico e pode mover a OS de fase (por exemplo, pular para a fase 6).

O fluxo completo das fases aparece no desenho abaixo.

&#91;embedded content: fluxo das fases da OS · 2 a 10, com reprovações\\]

Com inspeção, a OS passa pelas fases 2 a 5 antes da execução; uma reprovação na fase 5 ou 9 devolve a OS à fase do relatório.

## 7. Agendamento (fases 2 e 6)

O Comercial agenda a visita de inspeção na fase 2 e a execução na fase 6; a equipe agendada recebe notificação, e-mail e convite de calendário.

**Agendar** (seção Agendamentos → **+ Agendar**)

1. **Data** (não pode ser no passado). Na execução, informe também o **Último dia da execução** quando durar vários dias.
2. **Hora** (recomendada).
3. **Equipe**: marque as pessoas. Só aparecem usuários ativos.
4. **Equipamentos**: digite ou escolha do Catálogo. Se faltar algum equipamento do procedimento, o botão **Adicionar** aparece.
5. **Checklist de segurança**: NR-33, NR-10, EPIs e PT. Você pode acrescentar itens.
6. Salve.

**Data a definir**: se a data ainda não está combinada, marque **Data a definir** e, se quiser, **Lembrar em**. O agendamento aparece no Dashboard até alguém informar a data.

**Remarcar**: mudar a data (ou o último dia) substitui o agendamento anterior, que fica no histórico como "Remarcado de … para …". A equipe recebe aviso da remarcação.

**Avisos que podem aparecer** (não bloqueiam):

- pessoa ou equipamento já agendado em **outro local** no mesmo dia;
- sábado, domingo ou feriado nacional no período;
- equipe sem Coordenador ou Engenheiro;
- execução com relatório de inspeção ainda não aprovado.

Duas pessoas ou equipamentos no **mesmo local** (vários tanques do mesmo cliente) não geram aviso.

## 8. Coleta de dados da inspeção (fase 3)

Na fase 3 a equipe registra a medição de sedimento do tanque; uma medição aprovada alimenta o relatório. Registram: Operações e as funções com a permissão (Técnico, Auxiliar e outras liberadas).

**Formas de registrar** (seção Coletas)

| Botão | Quando usar |
| --- | --- |
| **Nova medição** | Abre o Medidor já com as dimensões do tanque; preencha a grade de leituras |
| **Digitar batimetria** | Lançar régua e sonar por vetor e ponto, como na planilha de campo |
| **Importar batimetria** | Carregar a planilha CSV/XLSX preenchida em campo |
| **Modelo vazio** | Baixar a planilha em branco para levar a campo |
| **Anexar PDF** | Guardar um documento (ex.: laudo) com descrição obrigatória |

**Ao salvar**, informe a **data da coleta** (vem da visita agendada) e o **responsável** (usuário cadastrado, com a equipe agendada no topo). Use **Salvar relatório (PDF)** para gerar o PDF da medição — ele atualiza a mesma coleta, sem duplicar.

**O sistema bloqueia** leituras negativas ou inválidas (indica a célula), medição idêntica já salva e PDF repetido ou acima de 20 MB. **Avisa** quando uma leitura passa da altura do tanque ou quando as medidas diferem mais de 5% do cadastro (oferece **Atualizar cadastro do tanque**).

**Aprovar a medição**: Gerência, Administrador e funções com a permissão (ex.: Coordenador) clicam em **Aprovar medição**. Só uma fica aprovada por OS. Editar uma medição aprovada retira a aprovação, e é preciso aprovar de novo.

## 9. Relatórios (fases 4 e 8)

O relatório é gerado no próprio sistema a partir do modelo do procedimento: relatório de inspeção na fase 4 e de execução na fase 8.

**Gerar** (seção Relatórios → **Gerar relatório**)

O modal **Gerar Relatório Técnico** mostra as seções **na mesma ordem e com os mesmos títulos do modelo** do procedimento (no POP 001: 1 a 14). Cada campo fica dentro da seção em que sai no documento.

1. Confira a **medição utilizada** (vem a aprovada).
2. Cliente, TAG, procedimento e endereço vêm do cadastro e não podem ser editados aqui — para mudar, corrija o cadastro.
3. Preencha datas, textos dos tópicos, equipe (já marcada pelo agendamento) e as pessoas que preparam, checam e aprovam.
4. Adicione as **fotos**: cada foto precisa de legenda, e a mesma foto não entra duas vezes. Até 10 MB; WebP e HEIC são convertidos. Nas seções com **vagas** do modelo (ex.: 7.1 Fotos do tanque), a lista mostra a legenda de cada vaga; toque na miniatura para ampliar a foto.
5. Clique em **Salvar rascunho** ou **Gerar**.

**Tópicos que saem do documento**

- Desmarcar a caixa do tópico tira a seção do documento; as seguintes são renumeradas.
- **Tópico não preenchido** (sem texto, sem foto e sem dado seu) também sai sozinho, inclusive o título. O tópico mostra **"não preenchido: fica fora do relatório"**. Vale para Preparação, Antes, Durante e Após a limpeza, Anexos (que sai sempre que houver PDF de laudo anexado) e Inspeção visual interna. Tópicos de texto padrão (Método, Análise Físico Química e Laboratorial, Recomendações) sempre saem.
- **Subtópico sem nenhuma foto** (ex.: "Higienização do robô" ou "Coleta para envio de análise") sai com o título, e os seguintes são renumerados.
- **Batimetria**: OS sem medição começa com a seção desmarcada ("sem medição nesta OS"). Marque para incluir.

**Acabamento automático do documento**: margens ABNT, texto corrido em Arial 12 com entrelinha 1,5 (inclusive os textos fixos do modelo), foto sempre na mesma página da legenda, fotos com no máximo 11 cm de altura e título nunca sozinho no pé da página. As figuras são numeradas na ordem em que aparecem.

**Rascunho**: existe um por OS e tipo, e as fotos ficam salvas nele. Ao reabrir, o quadro **O que mudou desde o rascunho** mostra os dados atualizados do cadastro e da medição.

**Revisão e código do relatório**: calculados automaticamente (Rev = número de reprovações). Só Administrador, Gerência e funções com a permissão editam à mão.

**Enviar para aprovação**: manda a versão à Gerência. Enviar uma nova versão enquanto outra aguarda **substitui** a anterior. Também dá para **Enviar** um arquivo editado fora do sistema (PDF ou DOCX real, até 30 MB).

**Relatório de execução (fase 8)**, além do acima:

- **⬇ Puxar das RDOs** (no topo do modal): preenche, só quando você clica, a **equipe** (os nomes das RDOs da OS, marcados entre os usuários cadastrados; quem não tem cadastro aparece no aviso), a **data de execução** (1ª RDO), a **data e os horários da operação** (chegada, início e conclusão da limpeza e saída) e as **Observações**, em texto corrido dia a dia ("No dia 23/09/2026, às 08:10h, equipe ASP chega ao site…"). Revise antes de gerar.
- **pH e cloro** antes e depois vêm da coleta de fotos; editar à mão mostra aviso de divergência. O botão **Valores de pH e cloro** fica nas seções **Antes da limpeza** e **Após a limpeza** (nos modelos antigos, em **Coleta das amostras**).
- **PDFs dos laudos do laboratório** (dois: **antes** e **após** a limpeza): anexe cada um no seu campo. **Ao anexar, os valores já entram na tabela** — nº do relatório de ensaio, resultado, incerteza, LQ, LD e limite dos 5 parâmetros — e as células lidas ficam **em azul** até você editar. PDF original do laboratório é lido pelo texto; PDF que é **imagem** (escaneado ou "Imprimir em PDF") é lido por **reconhecimento de texto (OCR)** no próprio sistema, sem IA — confira cada célula com o laudo. O mesmo arquivo não pode ser os dois laudos. Os dois são **obrigatórios para enviar à aprovação** (o rascunho pode ser salvo sem eles) e aparecem citados em **Anexos**.
- **Avisos da leitura**: o laboratório declarou **NÃO ATENDE**; pH ou cloro do laudo diferente do formulário; laudos possivelmente trocados (datas de coleta); linha que não deu para ler com segurança (fica em branco para digitar); "OCR com leitura duvidosa em: …".
- **Amostras e laudo** (botão na seção **Análise**): para conferir ou digitar à mão. Valores aceitos: números (as casas saem como no laudo: "2,60"), "\\<2,50" (abaixo do limite de quantificação), "\\<LQ", "ND", "Ausente", "Presente" e **"-"** — na coluna Valor é *não analisado*; em Incerteza, LQ e LD é *não informado*. Os limites vêm da Portaria GM/MS 888/2021 (heterotróficas: 500 UFC/mL, valor de referência). O documento traz **uma tabela única** com Antes, Após e Limite; Incerteza, LQ e LD servem à conferência (um "\\<LQ" sai com o valor do LQ).
- **No documento, a seção Análise traz**: a tabela **Valores medidos em campo** (pH e cloro antes e após a limpeza, com a referência da Portaria 888: pH 6,0 a 9,0; cloro 0,2 a 5); a tabela **Amostras enviadas ao laboratório** (nº do relatório de ensaio, data e ponto de coleta — lidos do laudo e editáveis no modal **Amostras e laudo**); a tabela de resultados; e, no subtópico **Laudos do laboratório**, as **páginas dos PDFs (prints)** como figuras de página inteira ("Laudo do laboratório — amostra antes da limpeza (Relatório de Ensaio …), página 1 de 2"). Para não incluir os prints, desmarque **Incluir as páginas dos laudos (prints) no relatório**, junto dos PDFs.
- **Avisos do laudo**: valor acima do limite ou P/A Presente; pH fora de **6,0 a 9,0**; cloro abaixo de 0,2 ou acima de 5; "\\<20" com limite 15 (não dá para afirmar que atende); limites diferentes entre os laudos; parâmetro fora do limite que nenhuma das conclusões cita como fora.
- **Conclusão das Análises Laboratoriais** (seção Análise): **preenchida automaticamente** a cada laudo anexado ("✍ Preenchida automaticamente… revise"), com frases prontas pelo cloro, pH e laudos — sempre dizendo de qual amostra fala e só afirmando conformidade com dado completo. Se você já escreveu no campo, o seu texto é mantido e aparece "há uma sugestão nova"; **Sugerir texto** refaz quando quiser. Vazio, o título não sai no documento.
- **Fotos da coleta**: entram sozinhas nas vagas do modelo, contando a história da operação — **Preparação** (higienização e robô) › **Antes da limpeza** (coleta de água, envio para análise, fundo do tanque) › **Durante a limpeza** › **Após a limpeza** (fundo limpo, coleta de água, envio para análise).

## 10. Aprovação e versão assinada (fases 5 e 9)

A Gerência aprova ou reprova a versão do relatório que está em aprovação; depois de aprovada, Comercial ou Gerência enviam a versão assinada em PDF.

**Aprovar**: abra a OS, baixe e leia a versão em aprovação e clique em **Aprovar relatório**. Antes de confirmar, o sistema pode avisar (sem bloquear):

- você preparou ou enviou esse relatório;
- você ainda não baixou essa versão;
- algo na OS mudou depois do envio (lista o quê);
- falta medição aprovada, laudo, RDO de algum dia ou fotos (na execução);
- resultado não conforme após a limpeza (cloro abaixo de 0,2 ou laudo fora do limite).

**Reprovar**: clique em **Reprovar (Ajustar)**, escolha a **categoria** (Dados incorretos, Fotos, Texto/redação, Medição, Formatação, Laudo/Laboratório ou Outro) e descreva o motivo com ao menos 15 caracteres. A OS volta uma fase e a equipe vê o motivo no topo da OS.

**Versão assinada**: com o relatório aprovado, Comercial, Gerência ou Administrador usam **Enviar versão assinada** (PDF real, até 30 MB). O relatório passa a "assinado" e ganha os botões **Baixar assinado** e **Baixar original**. Só Gerência e Administrador podem trocar a versão assinada.

Se duas pessoas aprovarem ao mesmo tempo, só a primeira vale; a segunda vê "Já aprovado por … em …".

## 11. Execução em campo (fase 7)

Durante a execução, a equipe registra pelo celular três coisas: a coleta de fotos, um RDO por dia e o checklist de equipamentos. Técnicos e Auxiliares podem registrar; aprovar, excluir e avançar fase continuam com Operações, Gerência e Administrador.

**Coleta de fotos da execução**

- Seções: Tanque (geral, ponto de abastecimento, saída da bomba), Robô no local, Higienização do robô (procedimento e robô higienizado), Coleta de água ANTES e DEPOIS da limpeza e Limpeza (antes, durante e depois).
- Toque em **📷 Foto** para usar a câmera ou **Galeria** para escolher. As fotos são comprimidas antes do envio.
- **Ver uma foto enviada**: toque na miniatura. A foto abre ampliada por cima da tela; feche com ✕, tocando fora dela ou com o **voltar** do celular — você continua na mesma OS. Em itens com várias fotos, use as setas ‹ › ou deslize o dedo.
- **Cópia no aparelho**: com a opção **Salvar cópia das fotos da câmera neste aparelho** (no topo da coleta, ligada por padrão), a foto original tirada pelo 📷 Foto também fica no celular. No Android ela vai sozinha para **Downloads** (aparece na galeria); no iPhone, toque em **💾 Salvar no aparelho** na vaga e escolha **Salvar Imagem**. Fotos da Galeria não são copiadas de novo.
- Nas coletas de água, preencha **pH** (0 a 14) e **cloro** (na unidade do procedimento, mg/L ou PPM). A seção fica em três grupos: **Local e ponto de coleta**, **pH e cloro** (com a foto do procedimento de pH e cloro) e **Envio para análise** (fotos do procedimento de coleta para envio e da coleta da amostra para o laboratório).
- As coletas de água e a higienização do robô só contam quando a caixa **Necessário (água potável)** está marcada. Na limpeza, marque **Limpeza confirmada** e envie no mínimo 3 fotos por etapa.
- O sistema bloqueia a mesma foto em dois itens e avisa quando a foto foi tirada fora do período da execução.

**RDO — Registro Diário de Operação** (um por dia, por projeto)

1. Na seção RDOs, clique em **+ Novo RDO** e confira a data.
2. Cabeçalho, equipe e equipamentos já vêm preenchidos; ajuste se preciso.
3. Marque as **condições do tempo** dos períodos trabalhados.
4. Lance as **atividades** com horário. Use as **frases rápidas** (chegada ao site, liberação da PT, coleta de amostra, almoço, saída).
5. Nas coletas de amostra, informe cloro e pH: a frase "dentro/abaixo do mínimo da CVS 6" é escrita automaticamente.
6. Escolha os assinantes (ASP e cliente) e clique em **Salvar e gerar** para baixar o .docx.

O RDO bloqueia pessoa repetida, atividade repetida, ordem impossível (saída antes da chegada) e data futura. Os demais pontos são avisos, com botões como **Remover horário do texto** e **Usar valor da coleta**.

**Checklist de equipamentos**: marque cada item conferido. Refazer a lista mantém as marcações dos itens que continuam.

**Avisos de pendências de campo**: em cada dia de execução, às **11h** e **16h** (e às **17h30** no último dia), quem está na equipe agendada recebe no sino e no celular o que ainda falta: fotos da coleta e o RDO de hoje. Os avisos param quando nada falta ou quando a OS sai da fase 7.

- Toque na notificação para abrir o widget **Pendências de campo — hoje**, no topo do Dashboard.
- No widget, **📷 Enviar fotos que faltam** mostra só as vagas pendentes, com Foto e Galeria ali mesmo; **📝 Preparar RDO de hoje** abre a OS na seção de RDOs.
- **Não avisar mais hoje** (na notificação, no Android, ou no widget) desliga os avisos só até o fim do dia.

## 12. Encerramento e entregas (fase 10)

Na fase 10, registre a entrega dos documentos ao cliente e encerre a OS; quando todas as OSs de um projeto são encerradas, o projeto fica Concluído sozinho.

**Registrar entrega ao cliente** (seção Entregas)

1. Clique em **Registrar entrega**.
2. Informe a data, o **contato** do cliente que recebeu, o **meio** (e-mail, impresso, pendrive ou outro) e marque os **arquivos entregues** (relatório assinado, laudo, RDOs, anexos).
3. Salve. O envio em si acontece fora do sistema; aqui fica o registro.

**Encerrar OS** (Comercial, Gerência ou Administrador)

1. Na barra de ações, veja a lista de **pendências**: relatórios sem versão assinada, laudo, RDOs desatualizados, dias sem RDO, fotos incompletas e rascunhos esquecidos. Cada pendência tem um link para corrigir.
2. Sem pendências, informe a data e clique em **Encerrar OS**.

**Encerrar manualmente**: em casos excepcionais, Gerência ou Administrador podem encerrar ignorando as pendências, com justificativa obrigatória. Fica registrado quem encerrou e o que foi ignorado.

**OS encerrada**: fica somente leitura, com a faixa "OS encerrada em … por …". Downloads e registro de entregas continuam permitidos.

**Reabrir**: Gerência ou Administrador, com motivo. A OS volta a aceitar edições e o projeto deixa de ser Concluído.

## 13. Catálogo

O Catálogo guarda os procedimentos e os equipamentos usados em todo o sistema; quem edita: Administrador, Operações e Gerência.

**Procedimentos**

- **Código** e **nome** únicos ("PO 011" e "PO011" contam como o mesmo código).
- **Métodos** e **equipamentos** do procedimento, sugeridos no agendamento e no checklist.
- **Tópicos do relatório**: o editor mostra o número que cada tópico terá no documento. Todo tópico precisa de título.
- **Modelo .docx** do relatório (arquivo Word real, até 20 MB). **⬇ Baixar modelo** (no procedimento e na lista) baixa o modelo em uso para conferir ou ajustar no Word.
- **Modelos 2026**: POP 001 (limpeza robotizada, em **linha do tempo**: Preparação › Antes › Durante › Após a limpeza) e P011 (inspeção visual), montados a partir dos relatórios atuais. Para trocar o modelo de um procedimento: **Voltar ao padrão**, enviar o novo .docx e **importar do modelo** para reimportar os tópicos — senão a lista antiga pode esconder seções.
- **Limpeza robotizada**: ativa o bloco de laudo e o PDF do laudo no relatório de execução.
- **Água potável**: deixa marcadas as coletas de água antes e depois na coleta de fotos.
- **Cloro**: unidade (mg/L ou PPM) e limite de aviso (padrão 5).

**Equipamentos**: nome único, especificações (rótulo e valor) e fotos (imagens até 10 MB). Remover uma foto só apaga o arquivo depois de salvar.

**Renomear item em uso**: o sistema mostra quantas OSs, checklists e rascunhos usam o item e atualiza todos ao confirmar. Relatórios já enviados, aprovados ou assinados não mudam.

**Desativar em vez de excluir**: um item em uso pode ser **desativado** — some das novas escolhas, mas continua válido nas OSs antigas. Excluir de vez só é permitido quando nada usa o item.

Use as setas ↑↓ para ordenar a lista.

## 14. Administração (somente Administrador)

A tela Administração de usuários tem três abas: Usuários, Funções e Permissões por função.

**Usuários**

1. **Criar**: informe e-mail, nome completo (nome e sobrenome), perfil e função. O sistema envia o convite **Criar minha senha** (vale 24 h).
2. Se o e-mail não puder ser enviado, use **Copiar link** e mande por outro meio, ou **Reenviar convite** depois.
3. **Enviar link de redefinição por e-mail**: para quem esqueceu a senha (vale 1 h).
4. **Desativar**: o sistema mostra os agendamentos futuros da pessoa e a retira dessas equipes. Se algum ficar sem equipe, Comercial e Gerência são avisados.

Proteções: e-mail não se repete; você não pode rebaixar, desativar ou excluir a si mesmo; o último administrador ativo não pode ser removido.

**Funções**: crie, renomeie (os usuários são atualizados), reordene, desative ou reative funções. Cada uma tem o **nome no RDO** (ex.: "Técnico de operações"). Uma função em uso não pode ser excluída, só desativada.

**Permissões por função**: uma matriz de caixas. Marque e clique em **Salvar**.

| Permissão | Libera |
| --- | --- |
| Aprovar medição | Botão Aprovar medição nas coletas |
| Excluir projetos/OS | Excluir e restaurar projetos, OSs, clientes, contatos e itens da Lixeira |
| Editar revisão do relatório | Alterar revisão e código do relatório |
| Liderança da equipe | Conta como liderança no aviso da execução |
| Registrar medições / batimetria | Criar e editar coletas |
| Registrar coleta de fotos | Enviar fotos e preencher pH e cloro |
| Preparar RDO | Criar e editar RDOs e gerar o .docx |

Administrador e Gerência (e Operações, nas três últimas) já têm esses direitos pelo perfil.

## 15. Dashboard de Operações, Arquivos e Lixeira

**Dashboard de Operações**: a visão geral da operação, com filtros de período, cliente, procedimento e pessoa. Os filtros ficam no endereço da página, então dá para compartilhar o link. Cada indicador tem um botão (i) com a definição exata e indica se mostra "Agora" ou "No período".

- **Indicadores**: OSs em andamento e paradas há mais de 15 dias, OSs encerradas, lead time, projetos concluídos, taxa de reprovação, relatórios aguardando aprovação ou assinatura e pendências de encerramento.
- **Funil das fases**: clique numa fase para listar as OSs dela.
- **Agenda**: próximos agendamentos, ocupação de pessoas e equipamentos, "data a definir" vencidos e conflitos.
- **Qualidade de campo**: RDOs faltando, fotos incompletas, medições sem aprovação e laudos fora do limite.
- **Próximos serviços recorrentes**: clientes perto do vencimento, com **+ Novo projeto**.
- Cada gráfico tem **Ver tabela**.
- **Pendências de campo — hoje**: no topo, para quem está na equipe de uma execução hoje, as fotos e o RDO que faltam em cada OS (veja a seção 11).

**Arquivos**: reúne os documentos de todos os projetos (medições, relatórios, versões assinadas, laudos, RDOs). Filtre por tipo e baixe um ZIP organizado em pastas por cliente, projeto e OS.

**Lixeira**: projetos, OSs, clientes, medições e relatórios excluídos ficam aqui por **30 dias** e podem ser restaurados. Depois disso são apagados de vez. Restaurar um item que duplicaria outro ativo é bloqueado.

## 16. Perguntas frequentes

| Situação | O que fazer |
| --- | --- |
| O botão Salvar está desativado | Procure o ⛔ ao lado dos campos; o resumo junto ao botão lista o que falta |
| Apareceu ⚠️ e não sei se posso seguir | Pode: ⚠️ é só alerta. Leia e confirme |
| O convite ou o link de senha não chegou | Veja o spam; peça ao Administrador para reenviar ou usar Copiar link |
| "Link vencido" ou "já usado" | Clique em Pedir novo link (convite: 24 h; redefinição: 1 h) |
| Não vejo o botão de uma ação | Seu perfil ou função não atua nessa fase (modo consulta). Fale com o Administrador |
| Não consigo editar nada na OS | A OS está encerrada. Gerência ou Administrador podem reabri-la |
| "Outra pessoa alterou … recarregue" | Alguém salvou antes de você. Clique em Recarregar e refaça a alteração |
| Registrei offline e não aparece | Aguarde a conexão; o indicador ⏳ mostra os itens na fila. Não limpe os dados do app |
| O ícone do app no celular está antigo | Android: atualiza em até 1 dia ou reinstale. iPhone: remova e adicione de novo à Tela de Início |
| Não recebo notificações no celular | Instale o app e permita as notificações nas configurações do aparelho |
| A foto da câmera não está na galeria | Confira se “Salvar cópia das fotos da câmera neste aparelho” está marcada. Android: veja a pasta Download da galeria. iPhone: toque em 💾 Salvar no aparelho e escolha Salvar Imagem |
| Não quero mais os avisos de pendências hoje | Toque em Não avisar mais hoje na notificação (Android) ou no widget do Dashboard. Amanhã os avisos voltam sozinhos |
| Um tópico sumiu do relatório gerado | Ele estava sem nada preenchido ("não preenchido: fica fora do relatório"). Preencha texto ou fotos e gere de novo |
| A equipe do relatório não bate com as RDOs | Clique em ⬇ Puxar das RDOs. Quem aparece "sem cadastro" precisa ser cadastrado como usuário |
| O laudo veio com "-" ou "<2,50" | Pode digitar assim: "-" é não analisado e "<2,50" é abaixo do limite de quantificação |
| O laudo anexado não preencheu a tabela | Confira o aviso no campo do laudo: linha ilegível fica em branco para digitar; PDF que não é Relatório de Ensaio é recusado |
| O laudo em PDF de imagem saiu com algum valor diferente | O OCR pode errar caracteres: compare as células em azul com o PDF e corrija. Se possível, peça ao laboratório o PDF original |
| A Conclusão das Análises não mudou ao trocar o laudo | Ela só se atualiza sozinha enquanto tem o texto automático. Se você editou, clique em Sugerir texto |
| As páginas do laudo não apareceram no relatório | Confira se os PDFs estão anexados e se a opção Incluir as páginas dos laudos (prints) está marcada |
| A tabela de valores medidos em campo não saiu | Ela só entra com pH ou cloro preenchidos (vêm da coleta de fotos ou do botão Valores de pH e cloro) |
| Não consigo enviar o relatório de execução | Faltam os PDFs dos laudos de antes e/ou de após a limpeza — anexe os dois e salve o rascunho |
| Seções do modelo novo não aparecem no modal | No Catálogo: Voltar ao padrão, envie o modelo e clique em importar do modelo |

Encontrou um erro ou tem uma sugestão? Use o botão **💬** na barra superior.
`;
