// DeskForge effect exporter for Unity (UNTESTED helper; it was written without Unity available).
// Put this file in any "Editor" folder of a Unity project (e.g. Assets/Editor/DeskForgeExporter.cs).
// Then: select a GameObject with a Particle System and choose  DeskForge > Export selected Particle System...
// It writes a .dfx file that DeskForge can import under Cursor effects > particles > "import a .dfx effect".
//
// What is exported is the MAIN look and motion only. Unity's renderer, materials, textures, sub-emitters, trails,
// noise and collisions are not carried over: DeskForge draws simple 2D dots. Units: 1 Unity unit = pixelsPerUnit px.
#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;

public static class DeskForgeExporter
{
    const float pixelsPerUnit = 100f;

    [System.Serializable]
    class DfxEffect
    {
        public string name;
        public string behavior = "sparks";   // sparks | fountain | drift | orbit
        public string[] colors;
        public string endColor = "";
        public float size, sizeEnd, speed, lifetime, rate, spread, gravity;
        public bool fade = true;
        public bool additive;
        public string emitWhen = "moving";
        public int maxParticles = 300;
    }

    [System.Serializable]
    class DfxFile
    {
        public string format = "deskforge-effect";
        public int version = 1;
        public DfxEffect effect;
    }

    static string Hex(Color c) { return "#" + ColorUtility.ToHtmlStringRGB(c).ToLowerInvariant(); }

    [MenuItem("DeskForge/Export selected Particle System...")]
    static void Export()
    {
        GameObject go = Selection.activeGameObject;
        ParticleSystem ps = go != null ? go.GetComponent<ParticleSystem>() : null;
        if (ps == null)
        {
            EditorUtility.DisplayDialog("DeskForge", "Select a GameObject that has a Particle System.", "OK");
            return;
        }

        var main = ps.main;
        var shape = ps.shape;
        var e = new DfxEffect();
        e.name = go.name;
        e.colors = new[] { Hex(main.startColor.Evaluate(0.5f)) };
        if (ps.colorOverLifetime.enabled) e.endColor = Hex(ps.colorOverLifetime.color.Evaluate(1f));
        e.size = main.startSize.Evaluate(0.5f) * pixelsPerUnit;
        e.sizeEnd = ps.sizeOverLifetime.enabled ? e.size * ps.sizeOverLifetime.size.Evaluate(1f) : e.size;
        e.speed = main.startSpeed.Evaluate(0.5f) * pixelsPerUnit;
        e.lifetime = main.startLifetime.Evaluate(0.5f);
        e.rate = ps.emission.rateOverTime.Evaluate(0.5f);
        e.gravity = main.gravityModifier.Evaluate(0.5f) * 9.81f * pixelsPerUnit; // positive = down on screen
        e.spread = shape.enabled && shape.shapeType == ParticleSystemShapeType.Cone ? shape.angle * 2f : 360f;
        e.maxParticles = Mathf.Min(main.maxParticles, 1500);

        var renderer = go.GetComponent<ParticleSystemRenderer>();
        if (renderer != null && renderer.sharedMaterial != null && renderer.sharedMaterial.shader != null)
            e.additive = renderer.sharedMaterial.shader.name.Contains("Additive");

        string path = EditorUtility.SaveFilePanel("Export DeskForge effect", "", go.name + ".dfx", "dfx");
        if (string.IsNullOrEmpty(path)) return;
        File.WriteAllText(path, JsonUtility.ToJson(new DfxFile { effect = e }, true));
        EditorUtility.DisplayDialog("DeskForge", "Exported. Import it in DeskForge under Cursor effects.", "OK");
    }
}
#endif
