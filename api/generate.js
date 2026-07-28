// Vercel Serverless Function: NEIS Open API Proxy Handler
// Open API Endpoint: https://open.neis.go.kr/hub

const NEIS_API_BASE = 'https://open.neis.go.kr/hub';
const NEIS_API_KEY = process.env.NEIS_API_KEY || 'sample';

/**
 * Allergen Code Dictionary (1 ~ 19)
 */
const ALLERGEN_MAP = {
  1: '난류(계란)', 2: '우유', 3: '메밀', 4: '땅콩', 5: '대두', 6: '밀',
  7: '고등어', 8: '게', 9: '새우', 10: '돼지고기', 11: '복숭아', 12: '토마토',
  13: '아황산류', 14: '호두', 15: '닭고기', 16: '쇠고기', 17: '오징어', 18: '조개류', 19: '잣'
};

/**
 * Parses raw meal dish string into clean dish name and allergen code array
 * e.g., "돈육불고기(10.)" -> { name: "돈육불고기", allergens: [10] }
 */
function parseMealDish(dishStr) {
  if (!dishStr) return { name: '', allergens: [] };

  const matches = dishStr.match(/\(([0-9\.]+)\)|\b([0-9\.]+)\b/g) || [];
  const numbers = new Set();

  matches.forEach(m => {
    const clean = m.replace(/[()]/g, '');
    clean.split('.').forEach(numStr => {
      const parsed = parseInt(numStr.trim(), 10);
      if (!isNaN(parsed) && ALLERGEN_MAP[parsed]) {
        numbers.add(parsed);
      }
    });
  });

  const cleanName = dishStr.replace(/[0-9\.\(\)]+/g, '').trim();

  return {
    name: cleanName,
    allergens: Array.from(numbers).sort((a, b) => a - b),
    raw: dishStr
  };
}

export default async function handler(req, res) {
  // Setup CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { query } = req;
  const action = query.type || 'meal';

  try {
    if (action === 'search') {
      const schoolName = query.keyword || '';
      const officeCode = query.office || '';

      if (!schoolName) {
        return res.status(400).json({ error: '학교명을 입력해주세요.' });
      }

      let url = `${NEIS_API_BASE}/schoolInfo?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=30&SCHUL_NM=${encodeURIComponent(schoolName)}`;
      if (officeCode) {
        url += `&ATPT_OFCDC_SC_CODE=${officeCode}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.schoolInfo) {
        const schools = data.schoolInfo[1].row.map(s => ({
          ATPT_OFCDC_SC_CODE: s.ATPT_OFCDC_SC_CODE,
          ATPT_OFCDC_SC_NM: s.ATPT_OFCDC_SC_NM,
          SD_SCHUL_CODE: s.SD_SCHUL_CODE,
          SCHUL_NM: s.SCHUL_NM,
          LCTN_SC_NM: s.LCTN_SC_NM,
          SCHUL_KND_SC_NM: s.SCHUL_KND_SC_NM,
          ORG_RDNMA: s.ORG_RDNMA
        }));
        return res.status(200).json({ success: true, count: schools.length, schools });
      } else {
        return res.status(200).json({ success: true, count: 0, schools: [], message: '검색된 학교가 없습니다.' });
      }
    }

    if (action === 'meal') {
      const officeCode = query.office || 'B10';
      const schoolCode = query.school || '7010057';
      const fromDate = query.from;
      const toDate = query.to;

      if (!fromDate || !toDate) {
        return res.status(400).json({ error: 'from 과 to 날짜 파라미터가 필요합니다.' });
      }

      const url = `${NEIS_API_BASE}/mealServiceDietInfo?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&MLSV_FROM_YMD=${fromDate}&MLSV_TO_YMD=${toDate}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.mealServiceDietInfo) {
        const meals = data.mealServiceDietInfo[1].row.map(item => {
          const rawDishes = item.DDISH_NM.split('<br/>').map(d => d.trim()).filter(Boolean);
          const parsedDishes = rawDishes.map(parseMealDish);

          return {
            date: item.MLSV_YMD,
            mealType: item.MMEAL_SC_NM,
            dishes: parsedDishes,
            calories: item.CAL_INFO || '정보 없음',
            origin: item.ORGC_INFO ? item.ORGC_INFO.replace(/<br\/>/g, ', ') : '원산지 정보 없음',
            nutrition: item.NTR_INFO ? item.NTR_INFO.replace(/<br\/>/g, ', ') : '영양 정보 없음'
          };
        });

        return res.status(200).json({ success: true, count: meals.length, meals });
      } else {
        return res.status(200).json({ success: true, count: 0, meals: [], message: '해당 기간의 급식 정보가 없습니다.' });
      }
    }

    if (action === 'schedule') {
      const officeCode = query.office || 'B10';
      const schoolCode = query.school || '7010057';
      const fromDate = query.from;
      const toDate = query.to;

      const url = `${NEIS_API_BASE}/SchoolSchedule?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&AA_FROM_YMD=${fromDate}&AA_TO_YMD=${toDate}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.SchoolSchedule) {
        const events = data.SchoolSchedule[1].row
          .filter(e => e.EVENT_NM && e.EVENT_NM !== '토요휴업일')
          .map(e => ({
            date: `${e.AA_YMD.substring(0, 4)}.${e.AA_YMD.substring(4, 6)}.${e.AA_YMD.substring(6, 8)}`,
            eventNm: e.EVENT_NM,
            eventCntnt: e.EVENT_CNTNT || '',
            type: e.EVENT_NM.includes('시험') || e.EVENT_NM.includes('고사') ? '시험' : '행사'
          }));

        return res.status(200).json({ success: true, count: events.length, events });
      } else {
        return res.status(200).json({ success: true, count: 0, events: [], message: '학사일정이 없습니다.' });
      }
    }

    return res.status(400).json({ error: '알 수 없는 요청 타입입니다.' });

  } catch (error) {
    console.error('NEIS Proxy Server Error:', error);
    return res.status(500).json({ error: '서버 연동 실패', details: error.message });
  }
}