// macOS export/reader check using the production share-card renderer. No phone, camera or user avatar.
import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO
import UniformTypeIdentifiers
import Vision
@main struct QRImageChecks {
 static func write(_ image: CGImage, to url: URL) throws {
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("PNG destination failed") }
  CGImageDestinationAddImage(destination, image, nil); guard CGImageDestinationFinalize(destination) else { fatalError("PNG export failed") }
 }
 static func read(_ url: URL) throws -> String {
  let request = VNDetectBarcodesRequest(); request.symbologies = [.qr]
  try VNImageRequestHandler(url: url).perform([request])
  guard let decoded = request.results?.first?.payloadStringValue else { fatalError("Saved share-card PNG is not readable") }; return decoded
 }
 static func main() throws {
  let directory = URL(fileURLWithPath: "/tmp/haskapp-share-card-checks", isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let avatarContext = CGContext(data: nil, width: 256, height: 256, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  avatarContext.setFillColor(CGColor(red: 0.95, green: 0.65, blue: 0.15, alpha: 1)); avatarContext.fill(CGRect(x: 0, y: 0, width: 256, height: 256)); avatarContext.setFillColor(CGColor(red: 0.15, green: 0.35, blue: 0.5, alpha: 1)); avatarContext.fillEllipse(in: CGRect(x: 45, y: 45, width: 166, height: 166))
  let safeTestAvatar = avatarContext.makeImage()!
  var lecture = Lecture(); lecture.id = "official-safe-sample:秋:1:1"; lecture.lecture_name = "QR検証サンプル（実在の授業ではありません）"; lecture.term = "2026年度 2学期（秋ターム）"; lecture.day_of_the_week = 1; lecture.period = 1; lecture.classroom = "サンプル教室"; lecture.memo = "PRIVATE_DO_NOT_SHARE"
  var second = lecture; second.id = "official-safe-sample:秋:3:2"; second.day_of_the_week = 3; second.period = 2; second.classroom = "別のサンプル教室"
  let payload = try encodeTimetable([lecture,second], term: lecture.term!)
  for (name, avatar) in [("test-avatar", Optional(safeTestAvatar)), ("placeholder", Optional<CGImage>.none)] {
   let card = try timetableShareCard(payload: payload, term: lecture.term!, page: 0, count: 1, avatar: avatar)
   let url = directory.appendingPathComponent(name + ".png"); try write(card, to: url)
   let decoded = try read(url); guard decoded == payload else { fatalError("Export changed QR payload") }
   let result = try decodeTimetable(decoded)
   guard result.count == 2, result[0].day_of_the_week == 1, result[1].day_of_the_week == 3, result[1].period == 2, result[1].classroom == second.classroom, shareableLectureGroups(result).count == 1, result.allSatisfy({ nonempty($0.memo) == nil && $0.absences == nil && $0.lecture_list_id == nil }) else { fatalError("Multi-slot share-card privacy/roundtrip failed") }
  }
  var rows: [Lecture] = []
  for day in 1...5 { for period in 1...5 { var row = lecture; row.id = "sample-\(day)-\(period)"; row.day_of_the_week = day; row.period = period; row.lecture_name = String(repeating: "長いサンプル科目", count: 12); row.instructor = String(repeating: "サンプル教員", count: 10); rows.append(row) } }
  let pages = try encodeTimetablePages(rows, term: lecture.term!); var recovered: [Lecture] = []
  for (index, page) in pages.enumerated() {
   let image = try timetableShareCard(payload: page, term: lecture.term!, page: index, count: pages.count, avatar: safeTestAvatar)
   let url = directory.appendingPathComponent("long-\(index + 1).png"); try write(image, to: url)
   let decoded = try read(url); guard decoded == page else { fatalError("Paginated exported card changed QR") }; recovered += try decodeTimetable(decoded)
  }
  guard recovered.count == 25, Set(recovered.map { "\($0.day_of_the_week):\($0.period)" }).count == 25 else { fatalError("Paginated exported cards dropped slots") }
  print("Passed saved-PNG -> Vision -> timetable checks: test avatar, placeholder, repeated weekday course, and all 25 long slots across \(pages.count) cards. macOS export test; iPhone UI/Photos/Share Sheet still unverified.")
 }
}
