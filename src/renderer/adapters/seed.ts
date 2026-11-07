import type { Chat } from './types.ts';
export const seed: Chat[] = [
  {
    "id": "minh-anh",
    "name": "Minh Anh",
    "avatar": "assets/avatar-minh-anh.png",
    "online": true,
    "pinned": true,
    "unread": 0,
    "isGroup": false,
    "isWork": false,
    "time": "14:27",
    "preview": "Ừm, tối mình họp nhé!",
    "historyRemaining": 24,
    "messages": [
      {
        "id": 1,
        "from": "them",
        "text": "Chiều nay bạn rảnh không?\nMình cần trao đổi chút về dự án ấy.",
        "time": "13:52"
      },
      {
        "id": 2,
        "from": "me",
        "text": "Mình rảnh nhé!\nBạn gửi tài liệu trước cho mình xem với.",
        "time": "13:55",
        "status": "sent"
      },
      {
        "id": 3,
        "from": "them",
        "attachment": "Kế hoạch dự án v2.pdf",
        "size": "2,4 MB · PDF",
        "time": "13:56"
      },
      {
        "id": 4,
        "from": "them",
        "text": "Đây là bản cập nhật mới nhất nhé!\nBạn xem qua giúp mình, có gì góp ý thêm nha.",
        "time": "13:56"
      },
      {
        "id": 5,
        "from": "me",
        "text": "Ok, mình xem ngay đây.\nTối mình họp nhé!",
        "time": "14:20",
        "status": "sent",
        "reaction": "👍 1"
      },
      {
        "id": 6,
        "from": "them",
        "text": "Ừm, tối mình họp nhé!",
        "time": "14:27",
        "reaction": "❤️ 1"
      }
    ]
  },
  {
    "id": "du-an",
    "name": "Nhóm Dự án",
    "avatar": null,
    "online": false,
    "pinned": false,
    "unread": 0,
    "isGroup": true,
    "isWork": true,
    "time": "13:40",
    "preview": "Nam: Đã cập nhật file thiết kế...",
    "historyRemaining": 18,
    "members": [
      { "name": "Nam", "role": "Quản trị nhóm" },
      { "name": "Minh Anh", "role": "Thành viên" },
      { "name": "Bạn", "role": "Trưởng nhóm" }
    ],
    "messages": [
      {
        "id": 7,
        "from": "them",
        "text": "Nam: Đã cập nhật file thiết kế mới vào thư mục chung.",
        "time": "13:40"
      },
      {
        "id": 8,
        "from": "me",
        "text": "Cảm ơn cả nhóm! Mình sẽ kiểm tra trong hôm nay.",
        "time": "13:42",
        "status": "sent"
      }
    ]
  },
  {
    "id": "gia-dinh",
    "name": "Gia đình ❤️",
    "avatar": "assets/avatar-family.png",
    "online": false,
    "pinned": false,
    "unread": 3,
    "isGroup": true,
    "isWork": false,
    "time": "08:22",
    "preview": "Mẹ: Cuối tuần về ăn cơm nhé!",
    "historyRemaining": 12,
    "members": [
      { "name": "Mẹ", "role": "Quản trị nhóm" },
      { "name": "Bố", "role": "Thành viên" },
      { "name": "Chị Hai", "role": "Thành viên" },
      { "name": "Bạn", "role": "Thành viên" }
    ],
    "messages": [
      {
        "id": 9,
        "from": "them",
        "text": "Mẹ: Cuối tuần về ăn cơm nhé!",
        "time": "08:22"
      },
      {
        "id": 10,
        "from": "them",
        "text": "Cả nhà nhớ về sớm nhé ❤️",
        "time": "08:23"
      }
    ]
  },
  {
    "id": "cong-viec",
    "name": "Công việc",
    "avatar": null,
    "online": false,
    "pinned": false,
    "unread": 0,
    "isGroup": true,
    "isWork": true,
    "time": "Hôm qua",
    "preview": "Bạn: Gửi báo cáo cuối ngày nhé.",
    "historyRemaining": 9,
    "members": [
      { "name": "Quản lý", "role": "Quản trị nhóm" },
      { "name": "Hoàng Long", "role": "Thành viên" },
      { "name": "Bạn", "role": "Thành viên" }
    ],
    "messages": [
      {
        "id": 11,
        "from": "me",
        "text": "Gửi báo cáo cuối ngày nhé.",
        "time": "17:44",
        "status": "sent"
      }
    ]
  },
  {
    "id": "hoang-long",
    "name": "Hoàng Long",
    "avatar": "assets/avatar-hoang-long.png",
    "online": false,
    "pinned": false,
    "unread": 0,
    "isGroup": false,
    "isWork": false,
    "time": "Hôm qua",
    "preview": "Ok bạn!",
    "historyRemaining": 6,
    "messages": [
      {
        "id": 12,
        "from": "them",
        "text": "Ok bạn!",
        "time": "18:15"
      }
    ]
  },
  {
    "id": "zalo",
    "name": "Zalo Official Account",
    "avatar": null,
    "verified": true,
    "pinned": false,
    "unread": 0,
    "isGroup": false,
    "isWork": false,
    "time": "Thứ 3",
    "preview": "Có gì mới trong Zalo? ✨",
    "historyRemaining": 3,
    "messages": [
      {
        "id": 13,
        "from": "them",
        "text": "Đây là tin nhắn mẫu, không đến từ Zalo.",
        "time": "10:20"
      }
    ]
  },
  {
    "id": "lop",
    "name": "Lớp 12A1",
    "avatar": "assets/avatar-class.png",
    "online": false,
    "pinned": false,
    "unread": 0,
    "isGroup": true,
    "isWork": false,
    "time": "Thứ 2",
    "preview": "Lan: Ảnh hôm nay nè 📸",
    "historyRemaining": 15,
    "members": [
      { "name": "Lan", "role": "Lớp trưởng" },
      { "name": "Minh Anh", "role": "Thành viên" },
      { "name": "Hoàng Long", "role": "Thành viên" },
      { "name": "Bạn", "role": "Thành viên" }
    ],
    "messages": [
      {
        "id": 14,
        "from": "them",
        "text": "Lan: Ảnh hôm nay nè 📸",
        "time": "09:07"
      }
    ]
  }
];
