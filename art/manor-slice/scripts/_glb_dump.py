import json
import struct
from pathlib import Path

ROOT = Path(r"D:\MyProjects\Claude\luna-island\art\manor-slice\export\gltf")


def load(path: Path) -> dict:
    b = path.read_bytes()
    n = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20 : 20 + n])


def interesting(name: str | None) -> bool:
    if not name:
        return False
    n = name.lower()
    return any(k in n for k in ("crank", "gable", "roof", "wind", "post", "drum", "hole"))


for fn in [
    "fv_well_stone.glb",
    "fv_burgage_l2.glb",
    "fv_burgage_l1.glb",
    "fv_granary_barn.glb",
    "fv_church_wooden.glb",
]:
    js = load(ROOT / fn)
    print("====", fn, "nodes", len(js.get("nodes", [])), "meshes", len(js.get("meshes", [])))
    for i, node in enumerate(js.get("nodes", [])):
        name = node.get("name")
        t = node.get("translation")
        r = node.get("rotation")
        if t or r or interesting(name):
            print(
                f"  [{i}] {name} mesh={node.get('mesh')} t={t} rot={r} scale={node.get('scale')} children={node.get('children')}"
            )
    print()
