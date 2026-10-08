#!/usr/bin/env python3
"""dev-detach.py — požene ukaz kot pravi daemon (dvojni fork + setsid).

Obhod problema: vrata (gateway) ob koncu vsakega Bash klica pobijejo VSE
potomce klicne lupine (hoja po drevesu otrok). setsid sam NE zadostuje, ker
spremeni le sejo, ne starševstvo. Dvojni fork prvnuka takoj odpne na PID 1
(starš izide še znotraj klica) — moravec ga tako ne najde več v drevesu.

Uporaba: python3 dev-detach.py <cwd> <ukaz> [args...]
"""
import os, sys

cwd = sys.argv[1]
cmd = sys.argv[2:]

pid = os.fork()
if pid > 0:
    sys.exit(0)  # prvi starš takoj izide — pravnuk dobi starša PID 1

os.setsid()
if os.fork() > 0:
    sys.exit(0)  # vodja seje izide — daemon je povsem odpnjen

os.chdir(cwd)
os.umask(0)
devnull = os.open(os.devnull, os.O_RDWR)
for fd in (0, 1, 2):
    os.dup2(devnull, fd)
if devnull > 2:
    os.close(devnull)

os.execvp(cmd[0], cmd)
