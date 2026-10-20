// ========================================
// 学部・学科・コース定義（選択肢および静的 affiliation_id 定義）
// ========================================

export type Faculty = {
  id: string;
  name: string;
  code: number;
  departments: Department[];
};

export type Department = {
  id: string;
  name: string;
  code: number;
  courses: Course[];
};

export type Course = {
  id: string;
  name: string;
  code: number;
  affiliationCode: string; // 例: "1-1-3" (工学部(1)-情エレ(1)-電気制御(3))
  affiliationId: string;   // 例: "00000001-0001-0003-0000-000000000000" (DBのUUID制約を満たす確定UUID)
};

/**
 * 簡易コード (例: "1-1-3") を Supabase の UUID 制約を満たす確定 UUID に変換します。
 */
export function codeToAffiliationUuid(code: string): string {
  const parts = code.split("-").map((p) => parseInt(p, 10) || 0);
  const p1 = String(parts[0] || 1).padStart(8, "0");
  const p2 = String(parts[1] || 1).padStart(4, "0");
  const p3 = String(parts[2] || 1).padStart(4, "0");
  return `${p1}-${p2}-${p3}-0000-000000000000`;
}

export const faculties: Faculty[] = [
  {
    id: "engineering",
    name: "工学部",
    code: 1,
    departments: [
      {
        id: "info-elec",
        name: "情報エレクトロニクス学科",
        code: 1,
        courses: [
          {
            id: "info-science",
            name: "情報理工学コース",
            code: 1,
            affiliationCode: "1-1-1",
            affiliationId: codeToAffiliationUuid("1-1-1"),
          },
          {
            id: "elec-elec",
            name: "電気電子工学コース",
            code: 2,
            affiliationCode: "1-1-2",
            affiliationId: codeToAffiliationUuid("1-1-2"),
          },
          {
            id: "elec-control",
            name: "電気制御システムコース",
            code: 3,
            affiliationCode: "1-1-3",
            affiliationId: codeToAffiliationUuid("1-1-3"),
          },
          {
            id: "bio-info",
            name: "生体情報コース",
            code: 4,
            affiliationCode: "1-1-4",
            affiliationId: codeToAffiliationUuid("1-1-4"),
          },
          {
            id: "media-net",
            name: "メディアネットワークコース",
            code: 5,
            affiliationCode: "1-1-5",
            affiliationId: codeToAffiliationUuid("1-1-5"),
          },
        ],
      },
    ],
  },
];

/**
 * 学部名・学科コース名などから静的に定義された確定 affiliationId (UUID) を取得します。
 */
export function getAffiliationId(facultyNameOrId: string, majorNameOrCourseName: string): string {
  for (const faculty of faculties) {
    const matchFaculty = faculty.id === facultyNameOrId || faculty.name === facultyNameOrId;
    for (const dept of faculty.departments) {
      for (const course of dept.courses) {
        const fullMajorName = `${dept.name} ${course.name}`;
        if (
          (matchFaculty && (course.name === majorNameOrCourseName || fullMajorName === majorNameOrCourseName || course.id === majorNameOrCourseName || course.affiliationCode === majorNameOrCourseName)) ||
          fullMajorName === majorNameOrCourseName ||
          course.name === majorNameOrCourseName ||
          course.id === majorNameOrCourseName ||
          course.affiliationCode === majorNameOrCourseName
        ) {
          return course.affiliationId;
        }
      }
    }
  }
  return codeToAffiliationUuid("1-1-1");
}

/**
 * 学部名・学科コース名などから "1-1-3" 形式の短縮コードを取得します。
 */
export function getAffiliationCode(facultyNameOrId: string, majorNameOrCourseName: string): string {
  for (const faculty of faculties) {
    const matchFaculty = faculty.id === facultyNameOrId || faculty.name === facultyNameOrId;
    for (const dept of faculty.departments) {
      for (const course of dept.courses) {
        const fullMajorName = `${dept.name} ${course.name}`;
        if (
          (matchFaculty && (course.name === majorNameOrCourseName || fullMajorName === majorNameOrCourseName || course.id === majorNameOrCourseName)) ||
          fullMajorName === majorNameOrCourseName ||
          course.name === majorNameOrCourseName ||
          course.id === majorNameOrCourseName
        ) {
          return course.affiliationCode;
        }
      }
    }
  }
  return "1-1-1";
}

/**
 * affiliationId (確定UUID または "1-1-3") から該当する学部・学科・コース情報を取得します。
 */
export function getCourseByAffiliationId(affiliationId: string): {
  faculty: Faculty;
  department: Department;
  course: Course;
} | null {
  for (const faculty of faculties) {
    for (const dept of faculty.departments) {
      for (const course of dept.courses) {
        if (course.affiliationId === affiliationId || course.affiliationCode === affiliationId) {
          return { faculty, department: dept, course };
        }
      }
    }
  }
  return null;
}
