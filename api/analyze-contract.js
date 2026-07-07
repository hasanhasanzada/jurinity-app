// Bu fayl serverdə (Vercel-də) işləyir, brauzerdə yox.
// Vəzifəsi: müqavilə mətnini götürüb Gemini API-a göndərmək və
// Jurinity tətbiqinin gözlədiyi formatda (huquqi / chatismayan / revisedText) cavab qaytarmaq.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Yalnız POST sorğusuna icazə verilir." });
    return;
  }

  const { contractText, role } = req.body || {};

  if (!contractText || typeof contractText !== "string") {
    res.status(400).json({ error: "contractText göndərilməyib." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY konfiqurasiya edilməyib (Vercel Environment Variables)." });
    return;
  }

  // Çox uzun mətnləri məhdudlaşdırırıq (Gemini-nin kontekst limitindən asılı olmayaraq, sürət və xərc üçün)
  const trimmedText = contractText.slice(0, 60000);

  const roleLine = role && role.mine
    ? `İstifadəçi bu müqavilədə "${role.mine}" tərəfindədir. Təhlili və təklifləri bu tərəfin mənafeyini nəzərə alaraq hazırla.`
    : "İstifadəçinin hansı tərəf olduğu bilinmir, buna görə neytral təhlil et.";

  const systemPrompt = `Sən Azərbaycan Respublikasının mülki hüququ üzrə ixtisaslaşmış müqavilə analitikisən.
Sənə mətni verilən bir müqavilə göndəriləcək. Vəzifən:
1) Müqavilədə mövcud olan, lakin İstifadəçi üçün risk yarada biləcək bəndləri tapmaq (huquqi risklər).
2) Adətən belə müqavilələrdə olması gözlənilən, lakin bu mətndə YOXA bənzəyən bənd/yarımbəndləri tapmaq (çatışmayan bəndlər).
3) Bu tapıntılar əsasında, müqavilənin TAM DÜZƏLDİLMİŞ versiyasını (bütün orijinal bəndlər + təklif olunan düzəlişlər inteqrasiya olunmuş şəkildə) hazırlamaq.

${roleLine}

Cavabını YALNIZ aşağıdakı JSON formatında ver, başqa heç bir mətn, izah və ya markdown əlavə etmə:
{
  "huquqi": [ { "title": "qısa başlıq", "detail": "problemin izahı", "suggestion": "konkret düzəliş təklifi" } ],
  "chatismayan": [ { "title": "bəndin adı", "detail": "niyə vacibdir", "suggestion": "hansı mətnin əlavə edilməsi tövsiyə olunur" } ],
  "revisedText": "tam düzəldilmiş müqavilə mətni (sadə mətn formatında, bənd nömrələri ilə)"
}

Əgər heç bir risk və ya çatışmazlıq tapmasan, "huquqi" və "chatismayan" massivlərini boş buraxa bilərsən, amma "revisedText" sahəsini yenə də doldur (orijinal mətnin özü ilə).`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\nMÜQAVİLƏ MƏTNİ:\n${trimmedText}` }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: "Gemini API xətası: " + errText.slice(0, 300) });
      return;
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      res.status(502).json({ error: "Gemini boş cavab qaytardı." });
      return;
    }

    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: "Gemini cavabı JSON formatında deyildi.", raw: cleaned.slice(0, 500) });
      return;
    }

    res.status(200).json({
      huquqi: Array.isArray(parsed.huquqi) ? parsed.huquqi : [],
      chatismayan: Array.isArray(parsed.chatismayan) ? parsed.chatismayan : [],
      revisedText: typeof parsed.revisedText === "string" ? parsed.revisedText : ""
    });
  } catch (e) {
    res.status(500).json({ error: "Server xətası: " + e.message });
  }
}
