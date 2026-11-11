#!/bin/sh
# Os efeitos sonoros dos vídeos, gerados por síntese (sem som de terceiros, sem licença a pagar).
# Rodar de dentro de apps/worker-videos: sh scripts/gerar-sons.sh
set -e
mkdir -p sons
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.7*sin(2*PI*2300*t)*exp(-t*95)+0.35*sin(2*PI*1150*t)*exp(-t*60)':s=48000:d=0.09" -af "afade=t=out:st=0.07:d=0.02" -ac 1 -c:a pcm_s16le sons/tique.wav
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.42:c=pink:a=0.9:r=48000:seed=7" -af "highpass=f=500,lowpass=f=5000,afade=t=in:d=0.22:curve=qsin,afade=t=out:st=0.22:d=0.2:curve=qsin,volume=1.4" -ac 1 -c:a pcm_s16le sons/sopro.wav
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.8*sin(2*PI*(500*t+5200*(1-exp(-t*40))/40))*exp(-t*32)':s=48000:d=0.16" -af "afade=t=out:st=0.13:d=0.03" -ac 1 -c:a pcm_s16le sons/estalo.wav
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.5*sin(2*PI*(260*t+1100*t*t))*min(1,t*6)*(1-max(0,t-0.42)/0.13)':s=48000:d=0.55" -af "afade=t=out:st=0.45:d=0.1,lowpass=f=6000" -ac 1 -c:a pcm_s16le sons/subida.wav
