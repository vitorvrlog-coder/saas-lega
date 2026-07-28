"""
Retry automático de LaunchInstance na Oracle Cloud (Always Free, VM.Standard.A1.Flex)
para contornar "Out of host capacity" em sa-saopaulo-1 (região com um único AD,
então não há AD alternativo pra tentar — só reenviar o pedido até a Oracle liberar
capacidade nova).

Uso: python scripts/oracle_retry_launch.py
Para depois de criar as 2 instâncias (INSTANCE_NAMES abaixo) ou ao ser interrompido.
"""
import subprocess
import sys
import time
import datetime

TENANCY = "ocid1.tenancy.oc1..aaaaaaaaqiifmagmrpsmmglxarukyvvg4yex4ru2eoj3j5gv3ff7t47vqywa"
AD = "jlsD:SA-SAOPAULO-1-AD-1"
SUBNET_ID = "ocid1.subnet.oc1.sa-saopaulo-1.aaaaaaaasx5emzynoq5tigopwqglyfstnsveb6dny2t577sn73xotkvlta3a"
IMAGE_ID = "ocid1.image.oc1.sa-saopaulo-1.aaaaaaaawvmdar75jvnrck56qxxqli2oafzdqc2wxadcnnr7zzis6fafd3dq"  # Canonical-Ubuntu-24.04-aarch64
SSH_KEY_PATH = r"C:\Users\User\.ssh\heimdall_oracle_vps.pub"
SHAPE = "VM.Standard.A1.Flex"
OCPUS = "1"
MEMORY_GB = "6"
RETRY_INTERVAL_SECONDS = 90

INSTANCE_NAMES = ["heimdall-vps-1", "heimdall-vps-2"]


def launch(name: str) -> bool:
    cmd = [
        "oci", "compute", "instance", "launch",
        "--compartment-id", TENANCY,
        "--availability-domain", AD,
        "--shape", SHAPE,
        "--shape-config", f'{{"ocpus": {OCPUS}, "memoryInGBs": {MEMORY_GB}}}',
        "--display-name", name,
        "--image-id", IMAGE_ID,
        "--subnet-id", SUBNET_ID,
        "--assign-public-ip", "true",
        "--ssh-authorized-keys-file", SSH_KEY_PATH,
        "--wait-for-state", "RUNNING",
        "--max-wait-seconds", "120",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print(f"[{datetime.datetime.now():%H:%M:%S}] {name}: CRIADA COM SUCESSO")
        print(result.stdout)
        return True
    stderr = result.stderr or result.stdout
    if "Out of host capacity" in stderr or "OutOfCapacity" in stderr:
        print(f"[{datetime.datetime.now():%H:%M:%S}] {name}: sem capacidade, tentando de novo em {RETRY_INTERVAL_SECONDS}s...")
    else:
        print(f"[{datetime.datetime.now():%H:%M:%S}] {name}: ERRO INESPERADO (não é falta de capacidade):")
        print(stderr[:2000])
    return False


def main():
    for name in INSTANCE_NAMES:
        print(f"--- Tentando criar {name} ---")
        while True:
            if launch(name):
                break
            time.sleep(RETRY_INTERVAL_SECONDS)
    print("As duas instâncias foram criadas.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompido pelo usuário.")
        sys.exit(1)
