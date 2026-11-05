# Rinha de Apartamentos 🥊

## Refinamentos 2026-11-05 (a partir das notas de nocaute)

Análise das notas dos nocautes → mudanças na busca:

1. "2 quartos"/"1 quarto" (~20 nocautes) → filtro estrito: anúncio sem preço/quartos/vagas informados NÃO entra no ringue (antes só filtrava quando o dado existia).
2. "Mobiliado" → palavra-chave de exclusão agora busca também na descrição do anúncio (parser Zap pega `description` do JSON-LD), não só no título.
3. "Valor maior no anúncio" → parser Zap agora usa o JSON-LD estruturado (`offers.price` real do anúncio, não preço de anúncio vizinho).
4. "Sem área pro cão" / gosto pessoal ("Feio", "Custo beneficio") → critério de votação humana, não filtrável antes do contato.
5. Bug de vagas: `addListing` gravava na chave 'Vagas' mas o header é 'Vagas Garagem' → 0/169 linhas com vaga. Corrigido no Code.gs (requer REDEPLOY manual do Apps Script) e o frontend lê 'Vagas Garagem' com fallback 'Vagas'.
