#!/usr/bin/env python3
"""Derive a village-only UBC male GLB from the unchanged source asset.

Keeps the armature, meshes, materials and the clips the village actually plays.
Resizes embedded images to <=1024 and drops unused animation binary. The source
GLB is never written.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import struct
from pathlib import Path

from PIL import Image

KEEP_CLIPS = (
    'Walk_Loop',
    'Idle_Loop',
    'Idle_Talking_Loop',
    'Fixing_Kneeling',
)
IMAGE_LIMIT = 1024
MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

COMPLETION = Path(__file__).resolve().parents[1]
SOURCE = COMPLETION.parents[1] / 'universal-base-characters' / 'assets' / 'ubc-male-ual.glb'
TARGET = COMPLETION / 'public' / 'assets' / 'ubc' / 'ubc-male-ual-village.glb'


def read_glb(path: Path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == MAGIC and version == 2 and length == len(data), f'{path}: not GLB v2'
    json_length, json_kind = struct.unpack_from('<II', data, 12)
    assert json_kind == JSON_CHUNK
    document = json.loads(data[20:20 + json_length])
    bin_start = 20 + json_length
    bin_length, bin_kind = struct.unpack_from('<II', data, bin_start)
    assert bin_kind == BIN_CHUNK
    binary = data[bin_start + 8:bin_start + 8 + bin_length]
    return document, binary, data


def write_glb(path: Path, document: dict, binary: bytes):
    header = json.dumps(document, separators=(',', ':')).encode()
    header += b' ' * ((-len(header)) % 4)
    packed = binary + (b'\x00' * ((-len(binary)) % 4))
    out = struct.pack('<III', MAGIC, 2, 28 + len(header) + len(packed))
    out += struct.pack('<II', len(header), JSON_CHUNK) + header
    out += struct.pack('<II', len(packed), BIN_CHUNK) + packed
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)
    return out


def view_blob(binary: bytes, view: dict) -> bytes:
    start = view.get('byteOffset', 0)
    return binary[start:start + view['byteLength']]


def accessor_indices(document: dict) -> set[int]:
    used: set[int] = set()
    for mesh in document.get('meshes') or []:
        for primitive in mesh.get('primitives') or []:
            used.update((primitive.get('attributes') or {}).values())
            if 'indices' in primitive:
                used.add(primitive['indices'])
            for target in primitive.get('targets') or []:
                used.update(target.values())
    for skin in document.get('skins') or []:
        if 'inverseBindMatrices' in skin:
            used.add(skin['inverseBindMatrices'])
    for animation in document.get('animations') or []:
        for sampler in animation.get('samplers') or []:
            used.add(sampler['input'])
            used.add(sampler['output'])
    return {index for index in used if isinstance(index, int)}


def resize_image(blob: bytes, mime: str | None) -> tuple[bytes, str, tuple[int, int], tuple[int, int]]:
    image = Image.open(io.BytesIO(blob))
    original = image.size
    if max(original) > IMAGE_LIMIT:
        image = image.copy()
        image.thumbnail((IMAGE_LIMIT, IMAGE_LIMIT), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    fmt = 'JPEG' if mime == 'image/jpeg' else 'PNG'
    if fmt == 'JPEG':
        if image.mode in ('RGBA', 'LA', 'P'):
            image = image.convert('RGB')
        image.save(output, format='JPEG', quality=92)
        mime = 'image/jpeg'
    else:
        image.save(output, format='PNG', compress_level=6)
        mime = 'image/png'
    return output.getvalue(), mime, original, image.size


def prepare(source: Path, target: Path) -> dict:
    document, binary, original = read_glb(source)
    source_sha = hashlib.sha256(original).hexdigest()
    animations = document.get('animations') or []
    names = [item.get('name') for item in animations]
    missing = [name for name in KEEP_CLIPS if name not in names]
    if missing:
        raise SystemExit(f'source is missing required clips: {missing}')
    document['animations'] = [item for item in animations if item.get('name') in KEEP_CLIPS]
    keep_names = [item.get('name') for item in document['animations']]
    if sorted(keep_names) != sorted(KEEP_CLIPS):
        raise SystemExit(f'clip filter failed: {keep_names}')

    accessors = document.get('accessors') or []
    views = document.get('bufferViews') or []
    used_accessors = accessor_indices(document)
    used_views: set[int] = set()
    for index in used_accessors:
        view = accessors[index].get('bufferView')
        if isinstance(view, int):
            used_views.add(view)
        sparse = accessors[index].get('sparse')
        if sparse:
            for key in ('indices', 'values'):
                part = sparse.get(key) or {}
                if isinstance(part.get('bufferView'), int):
                    used_views.add(part['bufferView'])
    images = document.get('images') or []
    image_blobs = {}
    image_report = []
    for image in images:
        view_index = image.get('bufferView')
        if not isinstance(view_index, int):
            raise SystemExit(f'image {image.get("name")} is not embedded')
        blob, mime, original_size, output_size = resize_image(view_blob(binary, views[view_index]), image.get('mimeType'))
        image['mimeType'] = mime
        image_blobs[view_index] = blob
        used_views.add(view_index)
        image_report.append({'name': image.get('name'), 'source': original_size, 'output': output_size, 'bytes': len(blob)})

    packed = bytearray()
    view_map = {}
    for old_index, view in enumerate(views):
        if old_index not in used_views:
            continue
        blob = image_blobs.get(old_index, view_blob(binary, view))
        while len(packed) % 4:
            packed.append(0)
        new_view = {key: value for key, value in view.items() if key not in {'buffer', 'byteOffset', 'byteLength'}}
        new_view['buffer'] = 0
        new_view['byteOffset'] = len(packed)
        new_view['byteLength'] = len(blob)
        view_map[old_index] = len(view_map)
        packed.extend(blob)
        views[old_index] = new_view
    document['bufferViews'] = [views[old] for old in sorted(view_map, key=lambda index: view_map[index])]

    def remap_view(index):
        if not isinstance(index, int):
            return index
        return view_map[index]

    accessor_map = {}
    new_accessors = []
    for old_index, accessor in enumerate(accessors):
        if old_index not in used_accessors:
            continue
        accessor = dict(accessor)
        if 'bufferView' in accessor:
            accessor['bufferView'] = remap_view(accessor['bufferView'])
        sparse = accessor.get('sparse')
        if sparse:
            sparse = dict(sparse)
            for key in ('indices', 'values'):
                if key in sparse:
                    part = dict(sparse[key])
                    part['bufferView'] = remap_view(part['bufferView'])
                    sparse[key] = part
            accessor['sparse'] = sparse
        accessor_map[old_index] = len(new_accessors)
        new_accessors.append(accessor)
    document['accessors'] = new_accessors

    def remap_accessor(index):
        return accessor_map[index]

    for mesh in document.get('meshes') or []:
        for primitive in mesh.get('primitives') or []:
            primitive['attributes'] = {name: remap_accessor(value) for name, value in primitive['attributes'].items()}
            if 'indices' in primitive:
                primitive['indices'] = remap_accessor(primitive['indices'])
            if 'targets' in primitive:
                primitive['targets'] = [{name: remap_accessor(value) for name, value in target.items()} for target in primitive['targets']]
    for skin in document.get('skins') or []:
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = remap_accessor(skin['inverseBindMatrices'])
    for animation in document.get('animations') or []:
        for sampler in animation.get('samplers') or []:
            sampler['input'] = remap_accessor(sampler['input'])
            sampler['output'] = remap_accessor(sampler['output'])
    for image in images:
        image['bufferView'] = remap_view(image['bufferView'])

    while len(packed) % 4:
        packed.append(0)
    document['buffers'] = [{'byteLength': len(packed)}]
    out = write_glb(target, document, bytes(packed))
    report = {
        'source': str(source),
        'target': str(target),
        'source_bytes': len(original),
        'source_sha256': source_sha,
        'output_bytes': len(out),
        'clips': keep_names,
        'images': image_report,
        'source_preserved': hashlib.sha256(source.read_bytes()).hexdigest() == source_sha,
    }
    target.with_suffix('.provenance.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


def inspect_glb(path: Path) -> dict:
    document, binary, data = read_glb(path)
    views = document.get('bufferViews') or []
    images = []
    for image in document.get('images') or []:
        blob = view_blob(binary, views[image['bufferView']])
        with Image.open(io.BytesIO(blob)) as parsed:
            images.append({'name': image.get('name'), 'size': parsed.size, 'mime': image.get('mimeType'), 'bytes': len(blob)})
    return {
        'path': str(path),
        'bytes': len(data),
        'clips': [item.get('name') for item in document.get('animations') or []],
        'skins': len(document.get('skins') or []),
        'meshes': [mesh.get('name') for mesh in document.get('meshes') or []],
        'images': images,
    }


def check(source: Path, target: Path) -> dict:
    if not target.is_file():
        raise SystemExit(f'missing derived village GLB: {target}')
    source_info = inspect_glb(source)
    output_info = inspect_glb(target)
    missing = [name for name in KEEP_CLIPS if name not in output_info['clips']]
    extra = [name for name in output_info['clips'] if name not in KEEP_CLIPS]
    oversized = [image for image in output_info['images'] if max(image['size']) > IMAGE_LIMIT]
    if missing:
        raise SystemExit(f'derived GLB missing clips: {missing}')
    if extra:
        raise SystemExit(f'derived GLB kept unexpected clips: {extra}')
    if oversized:
        raise SystemExit(f'derived GLB still has images above {IMAGE_LIMIT}: {oversized}')
    if output_info['skins'] != 1:
        raise SystemExit('derived GLB must keep the single UBC skin')
    source_after = hashlib.sha256(source.read_bytes()).hexdigest()
    report = {
        'ok': True,
        'source_bytes': source_info['bytes'],
        'output_bytes': output_info['bytes'],
        'clips': output_info['clips'],
        'images': output_info['images'],
        'source_sha256': source_after,
        'source_unchanged': True,
    }
    print(json.dumps({k: v for k, v in report.items() if k != 'images'}))
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--target', type=Path, default=TARGET)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        check(args.source, args.target)
        return
    report = prepare(args.source, args.target)
    check(args.source, args.target)
    print(json.dumps({k: v for k, v in report.items() if k != 'images'}))


if __name__ == '__main__':
    main()
