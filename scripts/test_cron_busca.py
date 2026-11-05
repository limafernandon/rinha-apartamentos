# -*- coding: utf-8 -*-
"""Testes do parser Zap (JSON-LD) e dos filtros estritos — Tarefa 2 do plano.

Roda offline via fixture. Uso: python scripts/test_cron_busca.py
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from cron_busca import parse_zap_ldjson, extrair_listings, passa_filtros  # noqa: E402

FIX = pathlib.Path(__file__).parent / "fixtures/zap_serra_ldjson.txt"

PREFS = {"Quartos Mínimos": 3, "Vagas Mínimas": 1, "Excluir Palavras-chave": "mobiliado"}


class TestParserZap(unittest.TestCase):
    def test_parse_zap_ldjson_campos_completos(self):
        items = parse_zap_ldjson(FIX.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(items), 25)
        it = items[0]
        self.assertTrue(it["titulo"] and "Zap id" not in it["titulo"])
        self.assertTrue(it["preco_aluguel"] and it["preco_aluguel"] > 500)
        self.assertIsNotNone(it["quartos"])
        self.assertGreaterEqual(it["quartos"], 1)
        self.assertIsNotNone(it["vagas"])
        self.assertIsNotNone(it["area"])
        self.assertGreater(it["area"], 20)
        self.assertEqual(it["custo_total"], it["preco_aluguel"] + it["condominio"])
        self.assertTrue(it["link"].startswith("https://www.zapimoveis.com.br/imovel/"))

    def test_passa_filtros_reprova_dados_incompletos(self):
        ok, motivo = passa_filtros({"titulo": "x", "quartos": None, "vagas": None,
                                    "custo_total": None, "preco_aluguel": None}, PREFS)
        self.assertFalse(ok)
        self.assertIn("dados", motivo)

    def test_passa_filtros_reprova_mobilado_pelo_titulo(self):
        ok, motivo = passa_filtros({"titulo": "Apartamento mobiliado 2 quartos", "quartos": 2,
                                    "vagas": 1, "custo_total": 3000}, PREFS)
        self.assertFalse(ok)
        self.assertIn("mobiliado", motivo)

    def test_extrair_listings_zap_usa_fixture(self):
        items = extrair_listings("Zap", "fixture://" + str(FIX))
        self.assertTrue(items)
        self.assertTrue(all(i["titulo"] for i in items))


if __name__ == "__main__":
    unittest.main(verbosity=2)
