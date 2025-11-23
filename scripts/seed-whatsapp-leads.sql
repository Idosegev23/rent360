-- Sample WhatsApp bot data for testing
-- This represents the JSON output from the WhatsApp bot

-- First, let's get an organization ID to use
-- You'll need to replace this with an actual org_id from your database
-- SELECT id FROM organizations LIMIT 1;

-- Sample WhatsApp lead 1: ניר זמיר from the bot example
INSERT INTO whatsapp_leads (
    org_id,
    raw_json,
    conversation_summary,
    first_name,
    last_name,
    krayot_area,
    budget,
    rooms,
    move_in_date,
    pets,
    furnished,
    mamad,
    balcony,
    has_checks,
    has_guarantors,
    features,
    extra_requests,
    processing_status
) VALUES (
    (SELECT id FROM organizations LIMIT 1), -- Replace with actual org_id
    '{
        "summary_he": "ניר זמיר מחפש דירת 3 חדרים בקרית מוצקין, עד 5000 ש\"ח, כניסה באוגוסט, חשוב מרפסת, ממ\"ד, חיות קטנות, חניה. יש צ׳קים וערבים.",
        "needs": {
            "krayot_area": "קרית מוצקין",
            "budget": 5000,
            "rooms": 3,
            "move_in_date": "אוגוסט",
            "features": ["מרפסת", "ממ״ד", "חניה"],
            "pets": true,
            "furnished": false,
            "mamad": true,
            "balcony": true,
            "contract_needs": {
                "has_checks": true,
                "has_guarantors": true
            },
            "extra_requests": []
        },
        "personal": {
            "first_name": "ניר",
            "last_name": "זמיר"
        },
        "end_conversation": true
    }',
    'ניר זמיר מחפש דירת 3 חדרים בקרית מוצקין, עד 5000 ש"ח, כניסה באוגוסט, חשוב מרפסת, ממ"ד, חיות קטנות, חניה. יש צ׳קים וערבים.',
    'ניר',
    'זמיר',
    'קרית מוצקין',
    5000,
    3,
    'אוגוסט',
    true,
    false,
    true,
    true,
    true,
    true,
    '["מרפסת", "ממ״ד", "חניה"]'::jsonb,
    '[]'::jsonb,
    'pending'
);

-- Sample WhatsApp lead 2: ענת אברהם from the bot example
INSERT INTO whatsapp_leads (
    org_id,
    raw_json,
    conversation_summary,
    first_name,
    last_name,
    krayot_area,
    budget,
    rooms,
    move_in_date,
    pets,
    furnished,
    mamad,
    balcony,
    has_checks,
    has_guarantors,
    features,
    extra_requests,
    processing_status
) VALUES (
    (SELECT id FROM organizations LIMIT 1),
    '{
        "summary_he": "ענת אברהם מחפשת דירת 2 חדרים בקריית ביאליק, עד 4000 ש\"ח, כניסה בעוד חודש. לא מעוניינת לפרט על אמצעי תשלום.",
        "needs": {
            "krayot_area": "קריית ביאליק",
            "budget": 4000,
            "rooms": 2,
            "move_in_date": "בעוד חודש",
            "features": [],
            "pets": false,
            "furnished": null,
            "mamad": null,
            "balcony": null,
            "contract_needs": {
                "has_checks": null,
                "has_guarantors": null
            },
            "extra_requests": []
        },
        "personal": {
            "first_name": "ענת",
            "last_name": "אברהם"
        },
        "end_conversation": true
    }',
    'ענת אברהם מחפשת דירת 2 חדרים בקריית ביאליק, עד 4000 ש"ח, כניסה בעוד חודש. לא מעוניינת לפרט על אמצעי תשלום.',
    'ענת',
    'אברהם',
    'קריית ביאליק',
    4000,
    2,
    'בעוד חודש',
    false,
    null,
    null,
    null,
    null,
    null,
    '[]'::jsonb,
    '[]'::jsonb,
    'pending'
);

-- Sample WhatsApp lead 3: דני כהן - more complex requirements
INSERT INTO whatsapp_leads (
    org_id,
    raw_json,
    conversation_summary,
    first_name,
    last_name,
    krayot_area,
    budget,
    rooms,
    move_in_date,
    pets,
    furnished,
    mamad,
    balcony,
    has_checks,
    has_guarantors,
    features,
    extra_requests,
    processing_status
) VALUES (
    (SELECT id FROM organizations LIMIT 1),
    '{
        "summary_he": "דני כהן מחפש דירת 4 חדרים בקרית אתא או קרית מוצקין, עד 6500 ש\"ח, כניסה מיד, חובה מרוהט, מעלית, חניה, מזגן. יש כלב קטן. יש צ׳קים אבל בעיה עם ערבים.",
        "needs": {
            "krayot_area": "קרית אתא",
            "budget": 6500,
            "rooms": 4,
            "move_in_date": "מיד",
            "features": ["מעלית", "חניה", "מזגן"],
            "pets": true,
            "furnished": true,
            "mamad": true,
            "balcony": true,
            "contract_needs": {
                "has_checks": true,
                "has_guarantors": false
            },
            "extra_requests": ["קומה גבוהה", "שקט"]
        },
        "personal": {
            "first_name": "דני",
            "last_name": "כהן"
        },
        "end_conversation": true
    }',
    'דני כהן מחפש דירת 4 חדרים בקרית אתא או קרית מוצקין, עד 6500 ש"ח, כניסה מיד, חובה מרוהט, מעלית, חניה, מזגן. יש כלב קטן. יש צ׳קים אבל בעיה עם ערבים.',
    'דני',
    'כהן',
    'קרית אתא',
    6500,
    4,
    'מיד',
    true,
    true,
    true,
    true,
    true,
    false,
    '["מעלית", "חניה", "מזגן"]'::jsonb,
    '["קומה גבוהה", "שקט"]'::jsonb,
    'pending'
);

-- Sample WhatsApp lead 4: רותי לוי - budget conscious
INSERT INTO whatsapp_leads (
    org_id,
    raw_json,
    conversation_summary,
    first_name,
    last_name,
    krayot_area,
    budget,
    rooms,
    move_in_date,
    pets,
    furnished,
    mamad,
    balcony,
    has_checks,
    has_guarantors,
    features,
    extra_requests,
    processing_status
) VALUES (
    (SELECT id FROM organizations LIMIT 1),
    '{
        "summary_he": "רותי לוי מחפשת דירת 2.5 חדרים בכל הקריות, תקציב מוגבל עד 3500 ש\"ח, כניסה בדצמבר, לא חובה מרוהט, חשוב ממ\"ד ומרפסת קטנה. יש צ׳קים וערבים.",
        "needs": {
            "krayot_area": "כל הקריות",
            "budget": 3500,
            "rooms": 2.5,
            "move_in_date": "דצמבר",
            "features": ["מרפסת קטנה"],
            "pets": false,
            "furnished": false,
            "mamad": true,
            "balcony": true,
            "contract_needs": {
                "has_checks": true,
                "has_guarantors": true
            },
            "extra_requests": ["קומה נמוכה", "ללא מדרגות"]
        },
        "personal": {
            "first_name": "רותי",
            "last_name": "לוי"
        },
        "end_conversation": true
    }',
    'רותי לוי מחפשת דירת 2.5 חדרים בכל הקריות, תקציב מוגבל עד 3500 ש"ח, כניסה בדצמבר, לא חובה מרוהט, חשוב ממ"ד ומרפסת קטנה. יש צ׳קים וערבים.',
    'רותי',
    'לוי',
    'כל הקריות',
    3500,
    2.5,
    'דצמבר',
    false,
    false,
    true,
    true,
    true,
    true,
    '["מרפסת קטנה"]'::jsonb,
    '["קומה נמוכה", "ללא מדרגות"]'::jsonb,
    'pending'
);

-- Sample WhatsApp lead 5: יוסי ומירי - couple with specific needs
INSERT INTO whatsapp_leads (
    org_id,
    raw_json,
    conversation_summary,
    first_name,
    last_name,
    krayot_area,
    budget,
    rooms,
    move_in_date,
    pets,
    furnished,
    mamad,
    balcony,
    has_checks,
    has_guarantors,
    features,
    extra_requests,
    processing_status
) VALUES (
    (SELECT id FROM organizations LIMIT 1),
    '{
        "summary_he": "יוסי גולדברג מחפש דירת 3.5 חדרים בקרית ים או קרית מוצקין, עד 5500 ש\"ח, כניסה בנובמבר, חובה מרוהט חלקית, מרפסת גדולה, חניה מקורה. זוג עם תינוק.",
        "needs": {
            "krayot_area": "קרית ים",
            "budget": 5500,
            "rooms": 3.5,
            "move_in_date": "נובמבר",
            "features": ["חניה מקורה", "מרפסת גדולה"],
            "pets": false,
            "furnished": true,
            "mamad": true,
            "balcony": true,
            "contract_needs": {
                "has_checks": true,
                "has_guarantors": true
            },
            "extra_requests": ["מתאים לתינוק", "שכונה שקטה", "קרוב לגן ילדים"]
        },
        "personal": {
            "first_name": "יוסי",
            "last_name": "גולדברג"
        },
        "end_conversation": true
    }',
    'יוסי גולדברג מחפש דירת 3.5 חדרים בקרית ים או קרית מוצקין, עד 5500 ש"ח, כניסה בנובמבר, חובה מרוהט חלקית, מרפסת גדולה, חניה מקורה. זוג עם תינוק.',
    'יוסי',
    'גולדברג',
    'קרית ים',
    5500,
    3.5,
    'נובמבר',
    false,
    true,
    true,
    true,
    true,
    true,
    '["חניה מקורה", "מרפסת גדולה"]'::jsonb,
    '["מתאים לתינוק", "שכונה שקטה", "קרוב לגן ילדים"]'::jsonb,
    'pending'
);
