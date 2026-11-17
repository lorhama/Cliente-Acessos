#!/usr/bin/env python3
"""Publicador de versões do Cliente Acessos (mesmo esquema do LoPDV: pacote .zip + versao.json assinado).

Uso (na pasta do projeto):
  python3 scripts/publicar.py 1.0.1 -c "correção feita" -m "melhoria feita"   nova versão (patch)
  python3 scripts/publicar.py 1.1.0 -m "algo grande" --maior                   muda MAIOR/MENOR (exige --maior)
  python3 scripts/publicar.py --atual                                          só reempacota a versão que já está no package.json
  ... --destino "C:\\...\\Versoes"                                            também guarda uma cópia em <destino>\\<versão>\\ (pacote, versao.json e o instalador, se existir em dist/)

O que faz: atualiza package.json, CHANGELOG.md e novidades.json; roda os testes; monta atualizacoes/atualizacao-<v>.zip
com os mesmos arquivos do instalador; assina "versão|sha256" (Ed25519) com a chave privada e confere com a chave pública
embutida no programa; grava atualizacoes/versao.json. Depois é só fazer commit e push: o programa instalado vê o aviso.

A chave privada NUNCA entra no Git. Ela é procurada, nesta ordem: --chave, variável CLIENTEACESSOS_CHAVE, .chaves/chave-privada-atualizacao.pem
"""
import argparse, base64, datetime, hashlib, json, os, re, shutil, subprocess, sys, tempfile, zipfile

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SAIDA = os.path.join(RAIZ, 'atualizacoes')
GUARDAR_PACOTES = 3          # quantos .zip antigos ficam no repositório (o programa só baixa o mais novo)


def ler_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def gravar_json(p, o, indent=2):
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(o, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def tup(v):
    return tuple(int(x) for x in v.split('.'))


def arquivos_do_programa(pkg):
    """Mesma lista que o instalador usa (build.files do package.json); 'pasta/**' inclui a pasta toda."""
    achados = set()
    for padrao in pkg['build']['files']:
        if padrao.endswith('/**'):
            base = os.path.join(RAIZ, padrao[:-3])
            if not os.path.isdir(base):
                sys.exit(f'Pasta listada em build.files não existe: {padrao}')
            for d, _ds, fs in os.walk(base):
                for f in fs:
                    achados.add(os.path.relpath(os.path.join(d, f), RAIZ).replace('\\', '/'))
        else:
            if not os.path.isfile(os.path.join(RAIZ, padrao)):
                sys.exit(f'Arquivo listado em build.files não existe: {padrao}')
            achados.add(padrao)
    return sorted(achados)


def montar_zip(destino, arquivos):
    # data fixa e ordem fixa: o mesmo conteúdo sempre gera o mesmo zip (e o mesmo SHA-256)
    with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in arquivos:
            zi = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            with open(os.path.join(RAIZ, rel), 'rb') as f:
                z.writestr(zi, f.read())


def achar_chave(arg):
    for c in (arg, os.environ.get('CLIENTEACESSOS_CHAVE'), os.path.join(RAIZ, '.chaves', 'chave-privada-atualizacao.pem')):
        if c and os.path.isfile(c):
            return c
    sys.exit('Chave privada de assinatura não encontrada. Use --chave CAMINHO, a variável CLIENTEACESSOS_CHAVE ou coloque em .chaves/chave-privada-atualizacao.pem')


def _assinar_texto(chave, texto, t):
    m, s = os.path.join(t, 'm'), os.path.join(t, 's')
    with open(m, 'wb') as f:
        f.write(texto.encode())
    subprocess.check_call(['openssl', 'pkeyutl', '-sign', '-inkey', chave, '-rawin', '-in', m, '-out', s])
    # confere com a chave pública que vai dentro do programa: se não bater, o programa recusaria a atualização
    r = subprocess.run(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', os.path.join(RAIZ, 'atualizacao-publica.pem'),
                        '-rawin', '-in', m, '-sigfile', s], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('A chave privada NÃO corresponde à chave pública embutida no programa (atualizacao-publica.pem). Nada foi publicado.')
    with open(s, 'rb') as f:
        return f.read()


def conferir_chave(chave):
    """Roda antes de mexer em qualquer arquivo."""
    with tempfile.TemporaryDirectory() as t:
        _assinar_texto(chave, 'teste', t)


def assinar(chave, versao, sha):
    with tempfile.TemporaryDirectory() as t:
        return base64.b64encode(_assinar_texto(chave, f'{versao}|{sha}', t)).decode()


def main():
    ap = argparse.ArgumentParser(description='Publicador de versões do Cliente Acessos')
    ap.add_argument('versao', nargs='?', help='nova versão MAIOR.MENOR.CORREÇÃO (maior que a atual)')
    ap.add_argument('-c', action='append', default=[], metavar='TEXTO', help='correção (pode repetir)')
    ap.add_argument('-m', action='append', default=[], metavar='TEXTO', help='melhoria (pode repetir)')
    ap.add_argument('--atual', action='store_true', help='reempacota a versão atual sem mudar nada')
    ap.add_argument('--maior', action='store_true', help='autoriza mudar MAIOR ou MENOR (ex.: 1.0.5 -> 1.1.0)')
    ap.add_argument('--chave', help='caminho da chave privada de assinatura')
    ap.add_argument('--destino', default=os.environ.get('CLIENTEACESSOS_VERSOES'), help='pasta onde guardar uma cópia de cada versão (ou variável CLIENTEACESSOS_VERSOES)')
    ap.add_argument('--sem-testes', action='store_true')
    a = ap.parse_args()

    pj = os.path.join(RAIZ, 'package.json')
    pkg = ler_json(pj)
    atual = pkg['version']
    hoje = datetime.date.today().strftime('%d/%m/%Y')

    if a.atual:
        if a.versao or a.c or a.m:
            sys.exit('--atual não combina com nova versão nem com notas.')
        versao = atual
    else:
        if not a.versao:
            sys.exit('Informe a nova versão (ex.: 1.0.1) ou use --atual.')
        if not re.fullmatch(r'\d+\.\d+\.\d+', a.versao):
            sys.exit('Versão no formato MAIOR.MENOR.CORREÇÃO (ex.: 1.0.1).')
        if not (a.c or a.m):
            sys.exit('Informe ao menos uma correção (-c) ou melhoria (-m): elas aparecem para você no aviso de atualização.')
        if tup(a.versao) <= tup(atual):
            sys.exit(f'A nova versão ({a.versao}) precisa ser maior que a atual ({atual}).')
        if tup(a.versao)[:2] != tup(atual)[:2] and not a.maior:
            sys.exit('Mudar MAIOR ou MENOR (ex.: 1.0.x -> 1.1.0) precisa do parâmetro --maior.')
        versao = a.versao

    chave = achar_chave(a.chave)
    conferir_chave(chave)

    # se qualquer etapa falhar, os arquivos de versão voltam ao que eram (nunca fica meio publicado)
    guardados = {}
    for n in ('package.json', 'novidades.json', 'CHANGELOG.md'):
        p = os.path.join(RAIZ, n)
        guardados[p] = open(p, 'rb').read() if os.path.isfile(p) else None
    try:
        publicar(a, pkg, pj, versao, hoje, chave)
    except BaseException:
        for p, b in guardados.items():
            if b is None:
                if os.path.isfile(p): os.remove(p)
            else:
                open(p, 'wb').write(b)
        zp = os.path.join(SAIDA, f'atualizacao-{versao}.zip')
        if not a.atual and os.path.isfile(zp):
            os.remove(zp)
        raise


def publicar(a, pkg, pj, versao, hoje, chave):
    if not a.atual:
        itens = [{'tipo': 'correcao', 'texto': x} for x in a.c] + [{'tipo': 'melhoria', 'texto': x} for x in a.m]
        pkg['version'] = versao
        gravar_json(pj, pkg)
        # novidades.json (mostrado no programa): versão nova no topo, guarda as 8 últimas
        npath = os.path.join(RAIZ, 'novidades.json')
        nov = ler_json(npath) if os.path.isfile(npath) else {'versoes': []}
        nov['versoes'] = [{'versao': versao, 'data': hoje, 'itens': itens}] + [v for v in nov['versoes'] if v['versao'] != versao]
        nov['versoes'] = nov['versoes'][:8]
        gravar_json(npath, nov, indent=1)
        # CHANGELOG.md
        cpath = os.path.join(RAIZ, 'CHANGELOG.md')
        txt = open(cpath, encoding='utf-8').read() if os.path.isfile(cpath) else '# Histórico de versões\n\n'
        linhas = [f'- Correção: {x}' for x in a.c] + [f'- Melhoria: {x}' for x in a.m]
        i = txt.find('\n## ')
        bloco = f'\n## {versao} — {hoje}\n' + '\n'.join(linhas) + '\n'
        txt = (txt[:i] + bloco + txt[i:]) if i >= 0 else (txt.rstrip('\n') + '\n' + bloco)
        open(cpath, 'w', encoding='utf-8', newline='\n').write(txt)
        print(f'package.json, novidades.json e CHANGELOG.md atualizados para {versao}.')

    if not a.sem_testes and shutil.which('node'):
        print('Rodando os testes…')
        # PUBLICANDO=1: o manifesto ainda é o da versão anterior (é gerado logo abaixo), então só esse confronto de versão é adiado
        if subprocess.call(['node', os.path.join(RAIZ, 'test', 'testes.js')], cwd=RAIZ, env={**os.environ, 'PUBLICANDO': '1'}) != 0:
            sys.exit('Os testes falharam: nada foi publicado e os arquivos de versão voltaram ao que eram.')

    os.makedirs(SAIDA, exist_ok=True)
    zp = os.path.join(SAIDA, f'atualizacao-{versao}.zip')
    montar_zip(zp, arquivos_do_programa(pkg))
    with open(zp, 'rb') as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    assinatura = assinar(chave, versao, sha)

    nov = ler_json(os.path.join(RAIZ, 'novidades.json'))['versoes']
    desta = next((x for x in nov if x['versao'] == versao), {'itens': [], 'data': hoje})
    man = {'versao': versao, 'data': desta.get('data') or hoje, 'arquivo': os.path.basename(zp), 'sha256': sha,
           'tamanho': os.path.getsize(zp), 'assinatura': assinatura, 'notas': desta['itens']}
    gravar_json(os.path.join(SAIDA, 'versao.json'), man, indent=1)

    # limpa pacotes antigos (mantém os mais novos)
    pacotes = sorted((f for f in os.listdir(SAIDA) if re.fullmatch(r'atualizacao-\d+\.\d+\.\d+\.zip', f)),
                     key=lambda f: tup(f[12:-4]))
    for f in pacotes[:-GUARDAR_PACOTES]:
        os.remove(os.path.join(SAIDA, f))

    print(f'Pacote: atualizacoes/{os.path.basename(zp)} ({man["tamanho"]} bytes)  SHA-256 {sha[:16]}…')
    print('Manifesto assinado: atualizacoes/versao.json')
    if a.destino:
        pasta = os.path.join(a.destino, versao)
        os.makedirs(pasta, exist_ok=True)
        copias = [zp, os.path.join(SAIDA, 'versao.json')]
        dist = os.path.join(RAIZ, 'dist')
        if os.path.isdir(dist):
            copias += [os.path.join(dist, f) for f in os.listdir(dist) if f.endswith(f'Setup {versao}.exe')]
        for c in copias:
            shutil.copy2(c, pasta)
        print('Cópia guardada em', pasta, '(' + ', '.join(os.path.basename(c) for c in copias) + ')')
    if not a.sem_testes and shutil.which('node'):
        print('Conferindo o pacote e o manifesto recém-gerados…')
        if subprocess.call(['node', os.path.join(RAIZ, 'test', 'testes.js')], cwd=RAIZ) != 0:
            sys.exit('ATENÇÃO: o pacote gerado não passou na conferência final. Não publique no GitHub.')
    print('Próximo passo: git add -A && git commit -m "Versão ' + versao + '" && git push')


if __name__ == '__main__':
    main()
