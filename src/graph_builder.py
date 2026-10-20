"""Knowledge Graph Builder for Laws Graphify

This script loads all target laws from data/laws_json, runs the citation resolver
on every article to identify references (edges), and compiles them into a single
knowledge graph JSON file (nodes & edges).
"""

import os
import json
from citation_resolver import extract_short_names, parse_citations, load_aliases, normalize_text

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def original_offsets(text):
    """Maps each normalized-text index to its index in the original text.

    normalize_text works character by character for statute text (full-width
    -> half-width), so offsets map 1:1 or 1:n. Returns None if that ever fails,
    and the caller then drops the spans rather than linking the wrong words.
    """
    starts = []
    for i, char in enumerate(text):
        starts.extend([i] * len(normalize_text(char)))
    if len(starts) != len(normalize_text(text)):
        return None
    return starts + [len(text)]


def build_graph():
    # 1. Load aliases and map law names to codes
    name_to_code = load_aliases()

    laws_dir = os.path.join(BASE_DIR, "data", "laws_json")
    if not os.path.exists(laws_dir):
        print(f"Directory {laws_dir} does not exist. Please run the download script first.")
        return

    nodes = []
    edges = []

    print("Building Knowledge Graph from extracted laws...")

    # Iterate through all populated law files
    for filename in sorted(os.listdir(laws_dir)):
        if not filename.endswith(".json"):
            continue

        filepath = os.path.join(laws_dir, filename)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                law_data = json.load(f)

            law_name = law_data.get("name", "")
            law_code = name_to_code.get(normalize_text(law_name))

            if not law_code:
                # Fall back to the name itself so unmapped laws never collide
                law_code = law_name
                print(f" Warning: Law '{law_name}' code not found in aliases. Defaulting to '{law_code}'")

            print(f" -> Processing {law_name} ({law_code}) with {len(law_data.get('content', []))} articles...")

            # Real article order, so 前條/次條 can land on 之N sub-articles
            article_order = [(art.get("num", 0), art.get("sub_num"))
                             for art in law_data.get("content", []) if art.get("num")]
            # "(以下簡稱處理辦法)" defined in one article applies to the whole document
            short_names = {}
            for art in law_data.get("content", []):
                short_names.update(extract_short_names(art.get("article", "")))

            for art in law_data.get("content", []):
                main_no = art.get("num", 0)
                sub_no = art.get("sub_num")
                zh_no = art.get("zh", "")
                text = art.get("article", "")

                # num 0 = chapter heading ("第 一 章 總則"), not an article
                if not main_no:
                    continue

                # Format current node ID
                node_id = f"{law_code}-{main_no:04d}"
                if sub_no is not None:
                    node_id += f"-{sub_no:03d}"

                # Add node
                nodes.append({
                    "id": node_id,
                    "law_name": law_name,
                    "law_code": law_code,
                    "article_zh": zh_no,
                    "article_num": main_no,
                    "article_sub_num": sub_no,
                    "text": text
                })

                # Parse citations to generate edges
                # E.g. "62" or "62-1" as current coordinates
                curr_coord = f"{main_no}"
                if sub_no is not None:
                    curr_coord += f"-{sub_no}"

                parsed_edges = parse_citations(text, current_law_code=law_code, current_article_no=curr_coord,
                                               article_order=article_order,
                                               local_aliases=short_names)
                # An article citing the same target twice is still one edge;
                # every place it is cited is kept in "spans" (original text)
                offsets = original_offsets(text)
                merged = {}
                for edge in parsed_edges:
                    start, end = edge.pop("span")
                    key = (edge["target"], edge["sub_ref"], edge["kind"])
                    if key not in merged:
                        merged[key] = {**edge, "spans": []}
                        edges.append(merged[key])
                    if offsets:
                        span = [offsets[start], offsets[end - 1] + 1]
                        if span not in merged[key]["spans"]:
                            merged[key]["spans"].append(span)

        except Exception as e:
            print(f" Error processing file {filename}: {e}")

    # Output consolidated graph
    graph_data = {
        "nodes": nodes,
        "edges": edges,
        # name -> code, so the query page understands 憲法 / 政府採購法 etc.
        "aliases": name_to_code,
    }

    # web/ copy is what the dashboard fetches
    for output_graph_path in (os.path.join(BASE_DIR, "data", "laws_graph.json"),
                              os.path.join(BASE_DIR, "web", "laws_graph.json")):
        with open(output_graph_path, "w", encoding="utf-8") as out_f:
            json.dump(graph_data, out_f, ensure_ascii=False, indent=2)

    print(f"\nGraph compiled successfully!")
    print(f" - Total Nodes (Articles): {len(nodes)}")
    print(f" - Total Edges (Citations): {len(edges)}")
    print(f" - Saved to {output_graph_path}")


if __name__ == "__main__":
    # Ensure correct search path for imports if needed
    import sys
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    build_graph()